# Scoring rules — derived state, and where it corrects the artifact

The ball log is the only source of truth. `deriveInnings()` in
`packages/scoring/src/replay.mjs` folds it into the score, the scorecard, the
fall of wickets, partnerships, and every chart. Nothing stores a score.

This document exists for one reason: **the refactor from stored aggregates to
derived state changed scoring behaviour in six places.** Those changes are
listed below with their justification. They are not incidental — deriving the
figures made visible what hand-maintained counters had been getting wrong, and
each one now has a test in `packages/scoring/test/replay.test.mjs`.

If you disagree with any of these, change `replay.mjs` and the corresponding
test together. Do not reintroduce a stored counter.

---

## Why derive at all

The pre-repo artifact kept `runs`, `wickets`, `balls`, `extras`, `batsmen[]`,
`bowlers[]`, `fow[]` and `partnerships[]` *beside* `ballLog`, mutating both on
every commit path:

```js
striker.runs += v; striker.balls++;
inn.runs += v; bow.runs += v; overRuns += v;
logBallSeed(inn, ball);
```

Two states that can disagree eventually do. Every new scoring path — penalties,
retired hurt, obstruction, a mid-over rain interruption — was a fresh chance to
update six counters and miss one. The failure mode is a scorecard that does not
reconcile, discovered after the match, unfixable without a human reconstructing
what happened. For a product whose value proposition is a trustworthy record,
that is fatal.

Three things follow from deriving instead:

| | Stored aggregates | Derived |
|---|---|---|
| **Undo** | deep-copy snapshot stack, capped at 10 | `events.slice(0, -1)` — exact, unbounded |
| **Correcting an earlier ball** | impossible past the cap | edit the log, re-derive |
| **Client/server agreement** | two implementations to keep in step | one fold, imported by both |

The capped undo was the visible symptom. A scorer who realised at ball 14 that
ball 2 was wrong could not fix it. That was never a design — it was a workaround
for the storage decision.

---

## The six corrections

### 1. Odd runs off a no-ball rotate the strike

The artifact's no-ball branch returned before reaching its rotation call:

```js
if(type==="Nb"){ …; logBall(i,ball); return; }   // never rotated
```

Runs off a no-ball are run between the wickets like any other. An odd number
changes the striker. **Consequence of the old behaviour:** after a single-run
no-ball, every subsequent delivery in that over was attributed to the wrong
batter.

### 2. Byes run off a wide rotate the strike

Same cause, same correction. A wide that the batters run a bye off is still runs
between the wickets.

### 3. A no-ball with no run off the bat is a ball faced

The artifact guarded the increment behind `value > 0`:

```js
if(bat && value>0){ bat.runs+=value; bat.balls++; … }
```

A batter facing a no-ball has faced a delivery whether or not they scored. By
convention balls-faced excludes wides but includes no-balls. The old behaviour
made strike rates read slightly high for anyone who faced a dot no-ball.

### 4. Maidens are counted

`bowlers[].maidens` existed in the artifact's bowler record and was never
written to — it read 0 for every bowler in every match.

A maiden here is a completed over (six legal deliveries) off which the bowler
conceded nothing. Byes and leg byes are **not** charged to the bowler and so do
not spoil a maiden; wides and no-balls **are**, and do.

### 5. The fielder survives replay

The artifact's wicket log entry carried `dismissal: mode` but dropped the
fielder, which lived only in the mutable batter record:

```js
const ball={type:"W", …, dismissal:mode};   // fielder lost
```

Replaying that log could never reproduce `c Botha b Mkhize`. The fielder is now
on the event, and `describeDismissal()` renders proper scorecard notation.

### 6. Free hits are enforced

The artifact tracked a free-hit banner in UI state but did not apply the rule to
dismissals. A free hit now saves the batter from every mode of dismissal except
those that stand on a free hit — run out, and the other non-delivery
dismissals — and is consumed by the next legal delivery.

**In SQL (db/42).** Every SQL reader of `ball_event` that counts a wicket asks `ball_wicket_stands()`, the fold's
rule in SQL: a W ball on a free hit stands only when its method is one of `NON_DELIVERY` (run out, handled the ball,
obstructing the field, hit the ball twice, timed out, retired out). Whether a ball is on a free hit is
`ball_on_free_hit()`: the last earlier delivery of the innings that was not a wide, voids excluded, was a no-ball.
The live score, the handover check (`scoring_verify_takeover`), a batter's dismissals, innings and breakdown, a
bowler's figures, hat-trick, breakdown and milestones, the opposition's figures and the matchups read all agree with
the fold; `tools/smoke-free-hit.mjs` holds them to it over generated logs.

---

## Rules the engine implements that were already correct

Kept deliberately, listed so a future reader does not "fix" them back:

- **Wides and no-balls do not consume a ball of the over.** `isLegal()`.
- **Byes and leg byes are not charged to the bowler** but do count as balls
  bowled, and are balls faced by the batter. Off a no-ball they are No-ball
  extras and are charged to him, like every run of a no-ball (SCRBRD-068).
- **Run outs and the other non-delivery dismissals are not credited to the
  bowler** — see `UNCREDITED` in `replay.mjs`.
- **The bowler is cleared at the end of each over**, so the next `bowler` event
  is required before the following over can be scored. This mirrors the
  artifact and is what forces the new-over prompt.
- **The one-run penalty for a wide or no-ball is added during replay**, never
  baked into the event's `value`. A caller cannot double-count it.

## Partnerships

Measured as the run *delta* while a pair is together, so extras are included —
which is how partnerships are actually reported. Balls counts legal deliveries.
The artifact summed `value` only, which under-reported any partnership that
included extras.

---

## Reduced overs — the umpires' revision

Rain, bad light, a late start: the umpires cut the innings to fewer overs
and, for a chase, set a new target. SCRBRD records that as an event in the
log — `revision({ overs, target, reason })` — never as an edit to the match
row. Everything that reads the innings derives from it: the pad's over
count, the innings-over rule (`inn.overs`), the result (`inn.target`), the
second device after a handover, and the server's own replay. The revision
itself is on the record with who made it and when.

The result of a chase is judged against the **target**, which is one more
than the first innings unless revised. In a rain-cut chase of 90 to beat a
150, 100 is a win by wickets; 88 is a loss by one run; 89 is a tie. The
engine used to compare the two totals, which was right only while those
were the same number.

There is no DLS or VJD calculation. The figures are the umpires', typed. A
school ground has no resource tables, and a wrong automatic target is worse
than a typed one.

## What the server refuses at commit

The pad's rules bind only the pad. A second client, an older build or a queue
replayed after a handover could append anything, and the log is append-only,
so the server now judges every live event before it is written
(`services/api/write/events-api.mjs`, inside the per-match lock) with ONE
function, `lawsRefusal(match, ev)` in `packages/scoring/src/laws.mjs`, over
the fold of the log so far (`MatchFold` — the same `deriveInnings` switch,
extended one event at a time, never a second fold). The pad asks the same
function (the new-over sheet does today).

Refused, with the reason named:

| Rule | Source |
|---|---|
| A ball needs an innings, batters at both ends and a bowler; not in a closed or finished innings | `scoringReadiness()` (the pad's own gate) |
| Striker and non-striker are different players | AntiGravity `validateDelivery` |
| No bowler bowls two overs, or parts of two, running (Law 17.8) | AntiGravity; "parts thereof" added |
| A bowler replaced during an over says why: injury or suspension (Law 17.8.1) | SCRBRD-080 |
| Whoever is out on a wicket must be one of the two batting | AntiGravity |
| No ball once the second innings is complete — the match is decided | AntiGravity `recordBallAction` |
| An innings starts only when the one before it has ended (by the laws or a seal) | new, from the model |
| No play in an innings once a later one has a delivery | new |
| A dismissed batter, or one retired out, does not come back; retired hurt may (Law 25.4) | new |
| Once play starts, a not-out batter leaves only by dismissal or retirement — no replacing him; swapping ends is allowed | new |
| Only a batter at the crease can retire; nothing is recorded for an innings nobody opened | new |
| A wicket with no ball is retired out (a batter who is in) or timed out (the batter due in, Law 40) — nothing else | SCRBRD-081 |
| Runs off a no-ball are off the bat, byes or leg byes — nothing else | SCRBRD-068 |
| The end a batter was out at is the striker's or the bowler's, and only on a wicket | SCRBRD-069 |
| A live `void` names the latest event that still counts in the innings in play — last in, first out, as the pad's undo. Anything older is an amendment (a second person, `scoring_amendment`) | new, `undo.mjs` |

Not refused, deliberately — each would need a product decision: a dismissal on
a free hit (§6 above records it and saves the batter), a stale or wrong seal (`sealRefusal` records and ignores it), a late
capture-profile declaration, the number of innings a format has, and whether a
typed player is in the squad.

A refusal is **per event**, in the response's `refused` bucket, and the rest of
the batch is still judged: a 4xx would leave an offline queue resending the same
illegal ball forever. The sync engine holds refused events on the device for a
person (`packages/sync`, `held`) — the server wrote nothing.

What that person does (SCRBRD-070, `packages/sync/src/held.mjs`, the sheet
behind the pad's "Refused N" pill): every event the server accepted after a
refused one was judged against a log WITHOUT it, so the server's log is the
pad's log with the held events taken out. Two resolutions, each for one event
or for it and every event held after it:

- **Discard** — the event leaves the pad's log (the same path undo takes for an
  event that never left the device) and the held copy goes. The only
  resolution for a conflict: the server keeps the event it already has under
  that id.
- **Record again** — the same delivery (or bowler, or batters) taken out of its
  place and appended as a new event with a new id, where the server judges it
  afresh; the row's payload names the key it replaces (`resentFrom`). Offered
  only for a refusal, and only when `lawsRefusal` against the server's log says
  it would be accepted. A ball recorded again is credited to the batters and
  bowler at the crease when it is recorded, as a fresh tap would be.

Nothing is resent on its own. Discarding the cause of a cascade (a bowler
refused under Law 17.8, and the balls after him refused for want of a bowler)
does not make the rest legal — the server never had the bowler, so letting him
go changes nothing it knows; the balls become legal only once the scorer names
the right bowler, and then only by being recorded again. Undo that reaches a
held event drops it from the pad's log — last or not, never with a `void`,
which would name an event the server does not have and be refused and held in
its turn — and lets its held copy go (SCRBRD-071; the rule is `undoLast`'s
`isHeld` in `undo.mjs`, asked by `undoOnPad` in `held.mjs`). The handover
sheet warns while anything is held and does not block: held events are not in
the outbox.

Undo of an event that has **never left the device** — still in the outbox and
never put in a request (`SyncEngine.isUnsent`; every key is marked sent on disk
before its request goes out) — cuts it from the pad's log **and** withdraws it
from the outbox (`SyncEngine.withdraw`), or it would be sent anyway and the
server would hold a ball the pad no longer shows (SCRBRD-074). The withdrawal
is on disk before the shorter log is saved, so a crash between the two leaves
the ball in the log and out of the outbox, and the next start re-offers it:
never sent-and-not-shown. An event in flight, in a request that never answered,
or acknowledged in any session is undone with a `void`: the server may have it.
So is every event on a live pad whose outbox is not attached (no claim yet this
session). One rule, `undoLast` reading the outbox through `boundaryOf`.

The same key sent with a different body is a **conflict**, not a duplicate: each
row carries a fingerprint of what it says (db/36), and a key names one event.

### A ball released from quarantine meets the same Laws

A ball sent under a stale token is held (`ball_event_quarantine`) for somebody
holding `scoring.amend.approve` — not the scorer who sent it — to release or
discard. Releasing it used to write it with no judgement at all. Now
(SCRBRD-071, db/37) `quarantine_resolve()` decides who may release and takes
the live path's per-match lock; the API route then folds the log it landed on
and asks `lawsRefusal()` about it, exactly as for a live event. A refusal
writes nothing, leaves the ball held, and answers
`{ ok: false, reason: "laws_refused", law, text }`, `text` being the same words
as the pad's held sheet. The approver's two choices are theirs: **discard** it,
or **leave it held** until the log changes (a batter walks in, a bowler is
named) and release it then.

A ball held under a stale token and then re-sent, same key and same content, by
a device that now holds the token is written live like any other ball — judged,
at the next seq — and its held copy is closed as **superseded** in the same
statement (a trigger, so every writer reaches it). Nobody is asked to release a
ball already in the log. The same key with other content is still a conflict,
and its held copy stays for a person.

### An approved amendment meets the Laws, less last-in-first-out

An amendment (`scoring_amendment`: filed with `scoring.amend.request`, approved
by somebody else with `scoring.amend.approve`) appends a `void` of an OLDER
delivery — that is what it is for. Since SCRBRD-076 (db/38)
`scoring_amendment_decide()` takes the same per-match lock as the live path
and a release, so a live batch can no longer append after the void without
judging against it; the route then judges the void with `lawsRefusal()` in a
savepoint, as for a release. Every void rule applies **except** "only the
latest event" — that is the pad's undo, and applied here it would refuse
every amendment. In practice the one the Laws add is that the start of an
innings is never voided (`void_foundation`): the SQL function already answers
a missing, voided or void target as `no_such_live_delivery`. A refusal writes
nothing, leaves the request pending, and answers
`{ ok: false, reason: "laws_refused", law, text }`. The balls bowled after an
amended delivery are not re-judged; whether a correction should re-judge them
is a product decision.

### A value the record cannot hold is refused per event

A contact, trajectory, placement or capture profile outside `ball_event`'s
column CHECKs (db/07), or a value that is not the column's type, is refused
per event in `refused` — `contact_unknown`, `trajectory_unknown`,
`trajectory_without_contact`, `placement_invalid`, `capture_profile_unknown`,
`value_refused`, each with words in `REFUSAL_TEXT` — and the rest of the batch
is written (SCRBRD-077). It used to fail the whole batch with a 500 that the
device resent forever. The placement vocabularies `placement.mjs` owns are
checked at the door, before anything is held; everything else is judged by the
CHECKs themselves, the write of each event running in its own savepoint. A
held ball that carries one is refused, in words, when somebody tries to
release it.

## Adding a new scoring situation

Do not add a counter. Add an event kind in `events.mjs`, fold it in
`deriveInnings()`, and add the case to the test suite. If the new kind needs a
column the `ball_event` table does not have, put it in `payload` — `toRow()`
carries unknown fields there untouched, so capturing a new dimension never
requires a migration.

## Product decisions, 2026-09-24

Taken by the product owner on the rules the commit-time Laws check left open.

1. **Dismissal on a free hit — record it, batter not out.** Unchanged from §6. The pad records the ball and the
   appeal as they happened; the fold saves the batter (`standsOnFreeHit`). The server does not refuse it.
2. **Mid-over bowler change — allowed, with a reason.** Law 17.8.1: a bowler incapacitated or suspended may be
   replaced mid-over. The pad asks *Injury or suspended?* and records it on the `bowler` event; the one who finishes
   the over may not bowl the next (already enforced as "or parts thereof"). Built as SCRBRD-080.
3. **Run out with runs completed — ask which end.** One extra question on a run out that completed runs: out at the
   striker's end or the bowler's end (Law 38.2). The fold places the survivor from that. Built as SCRBRD-069.
4. **No-ball byes — fix the model.** A no-ball records runs off the bat and runs not off the bat separately; only
   the first is the batter's (Law 21.6, Law 23). Old events replay unchanged. Built as SCRBRD-068.
5. **Timed out and retired out are not deliveries.** Recorded as a dismissal event that is not a ball: the over's
   count and the bowler's figures are unaffected and the bowler gets no credit. Old matches replay unchanged.
   Built as SCRBRD-081 — see below.

### Which end after a run out that completed runs (SCRBRD-069)

**The shape.** A wicket may carry `outAt: "striker_end" | "bowler_end"` (`RUN_OUT_END`): the end the wicket was put down
at (Law 38.2). Omitted otherwise. The constructor refuses any other value, or the field on anything but a wicket; so
does the server (`out_at_unknown`).

**The fold.** When the wicket stands and the end is recorded, that end is empty and the survivor is at the other one —
whoever `dismissed` names (the striker by default). With runs completed the batters have crossed (Law 18), so the
pre-ball crease no longer says which end is which; the end does. The end-of-over change of ends applies after, as for
any wicket. With no end recorded — every log before this, and a run out with no run completed, which the pad does not
ask about — the dismissed batter's end before the ball empties, exactly as before. The runs completed are credited as
they always were (the striker's, charged to the bowler).

**The pad.** On a run out the wicket sheet asks who is out, how many runs were completed first (0–3), and — when any
were — *Out at the striker's end or the bowler's end?*; it will not confirm until that is answered. The new batter is
sent to the end that is empty.

This was `laws-spec.test.mjs`'s last KNOWN_GAP; it is now group E there, both ends.

### Byes and leg byes off a no-ball (SCRBRD-068)

**The shape.** A no-ball's `value` is the runs the batters completed (or the boundary allowance), as it is for a wide,
a bye or a leg bye. A new, optional field says whose they were: `nbRuns: "byes" | "leg_byes"` (`NB_RUNS`). Absent means
off the bat. The constructor refuses any other value, and the field on anything but a no-ball.

**Why not a second number beside `value`.** Every shipped SQL fold already reads a no-ball as `1 + value` — the live
score, the handover check (`scoring_verify_takeover`), the bowler's career runs conceded. Splitting the runs into two
numbers would have left all of them short by the byes, and a handover after a no-ball bye would have failed
verification. With `value` still the runs completed, they stay right with no migration; the new field only decides the
batter's share. And it is what old events already are: the pad asked for "runs scored off this ball", so a no-ball with
no `nbRuns` is off the bat and replays exactly as before.

**How it is scored (MCC Laws, Law 21 — "Runs resulting from a No ball – how scored").** The one-run penalty is a
No-ball extra. Runs completed off the bat are the striker's; otherwise they too are No-ball extras — not byes or leg
byes. Apart from a five-run penalty award, every run resulting from a no-ball is debited to the bowler. So:

| No-ball, 2 run | Side | Extras | Striker | Bowler | Strike |
|---|---|---|---|---|---|
| off the bat | +3 | nb +1 | +2 runs, +1 ball | +3 | kept (2 is even) |
| byes / leg byes | +3 | nb +3 | +0 runs, +1 ball | +3 | kept |

The team total and the bowler's figures do not depend on the answer; the batter's runs, fours and sixes do. A no-ball is
a ball faced either way. Strike is rotated by the runs completed. The pad records which of byes or leg byes it was
because that is what the scorer saw; the fold scores both as no-ball extras. (A competition playing conditions that
score them as byes and leg byes, not debited to the bowler, would read `nbRuns` differently — not modelled.)

**Consumers.** The fold (`runsOffBat()` in `events.mjs` is the one rule), the phases (fours and sixes, and their
invariant), the scorecard and ball-by-ball text, the one-batter wagon wheel's run count, the held sheet, the Laws
(an unknown `nbRuns`, or one on anything but a no-ball: `nb_runs_unknown`), and the matchups read in
`services/api/read/read-api.mjs` — which now counts only runs off the bat, and only fours and sixes off the bat: it
used to count every ball worth four, four byes and five wides included.

**The SQL career views (db/40).** They credited a no-ball's `value` to the striker. `db/40_career_follows_the_fold.sql`
redefines every one that computes a batter's runs from the log (`player_batting_since`, `player_innings`,
`opposition_squad`, and the milestone trigger) over `ball_runs_off_bat()`, which is `runsOffBat()` in SQL: a no-ball's
byes and leg byes are not his runs, fours or sixes, are still a ball he faced, and are still every run debited to the
bowler. A no-ball with no `nbRuns` scores exactly as before. The pad's no-ball, and its wicket ball, now carry the
striker, non-striker and bowler like every other delivery (they carried none, so neither was in any SQL career figure
— balls faced, runs conceded, no-balls).

### A bowler replaced during an over (SCRBRD-080)

**The shape.** The `bowler` event gains an optional `reason`: `"injury"` or `"suspended"`
(`BOWLER_CHANGE_REASON`). It is present only on a change during an over and omitted otherwise, so a bowler for a new
over is the same event it always was. The constructor refuses any other value.

**Mid-over** means a delivery of the over the next ball is in has been bowled, and a bowler is on (`isMidOver`, in
`replay.mjs`) — a wide or no-ball that opened the over counts. Correcting the opening bowler before the first ball is
not a change, and nor is naming a bowler when nobody is on (a pad holding balls the server refused for want of one,
SCRBRD-070's cascade): there is nobody to replace.

**No reason: refused.** Law 17.8.1 lets a bowler be replaced during an over only when he is incapacitated or
suspended, so the reason is what makes the change lawful, and the pad always asks. A new mid-over `bowler` event with no
reason, or one the model does not know, is refused at commit (`mid_over_no_reason`). Naming the bowler already on is
no change and needs none. Only new events are judged: a log from before the pad asked replays unchanged, its change
recorded with the reason unknown. An older build's change arrives without one and is held for a person, like any
refusal; its balls are still judged, against the bowler the server has.

**The fold.** Unchanged figures — each man is credited with the balls he bowled — plus `inn.bowlerChanges`: the over,
the legal balls of it already bowled, who left, who took over and why. "Or parts thereof" (Law 17.8) was already
enforced and still is: neither the man who left nor the one who finished the over may bowl the next.

**The pad.** "Chg Bowler" during an over opens the bowler sheet as *Change of Bowler*, which asks *Injury or
suspended?* and offers nobody until it is answered. The scorecard's bowling card lists each change ("Over 2.3: B Zulu
took over from A Nel (injured)"; "reason not recorded" for an old log).

### Timed out and retired out (SCRBRD-081)

**The shape.** A `retire` event marked `type: "W"`, with the canonical `dismissal` (`retired_out` or `timed_out`):
`retire({ batter, reason: "out" })` or `retire({ batter, reason: "timed_out" })`. Retired hurt is unchanged —
`retire({ batter, reason: "hurt" })`, no marker, no wicket, may resume.

**Why a flag on `retire` and not a new kind.** `retire` already is "a batter's innings ends with no delivery": retired
out was already one of its reasons, the server already judges it (the batter must be in; a batter retired out does not
return), the held sheet already names it, and an older build folding one still empties the end instead of ignoring an
unknown kind. And the marker is the one every shipped SQL fold already reads: `match_live_score` and
`scoring_verify_takeover` count a wicket as `ball_type = 'W'` and a ball as `kind = 'ball'`, so a retire row with
`ball_type = 'W'` is — to the public score and to the handover check — a wicket that is not a ball, with no migration.
A new kind would have needed the same marker to be counted.

**The fold.** A wicket, a fall-of-wicket entry at the score and overs when it fell, the batter out ("retired out",
"timed out"); `balls`, the over, the free hit and every bowler's figures unchanged. Retired out empties the batter's
end and closes the partnership; timed out is the incoming batter, so nothing at the crease changes. Each is also in
`inn.nonBallWickets` with the over it fell in, which is how phases file it (their wickets still sum to the innings').

**The Laws at commit.** Retired out: the batter is at the crease. Timed out (Law 40): an end is empty after a wicket or a
retirement (not the openers), and the batter is neither at the crease nor already out (`not_next_in`,
`batter_already_out`). Either is refused once the innings is over or closed. A `retire` marked W naming any other way
out is refused (`needs_a_delivery`).

**Old logs.** A W *delivery* naming timed out or retired out — the pad's shape until now — replays exactly as before (a
legal ball, in the bowler's overs, against the striker unless `dismissed` says otherwise) and is still accepted at
commit, so an older build's queue syncs. A `retire` with reason `out` and no marker (the model allowed it; nothing
emitted it) is still no wicket. Neither is rewritten.

**The pad.** Retired out is on the wicket sheet, which now asks which batter; it records the retire event, not a ball.
Timed out is not on the wicket sheet — both batters are in while it is open — but on the batting-order sheet while an
end is empty after a wicket or a retirement ("Incoming batter timed out?"), offered only when `lawsRefusal` would take
it. The new batter is sent to the end that is empty (it used to be the striker's, always — which after a wicket on the
last ball of an over dropped the not-out survivor from the crease, and the server refused it as `crease_occupied`).

**The SQL career views (db/40).** They read `kind = 'ball'`, so a retired out or timed out recorded this way was in no
player's career. `db/40_career_follows_the_fold.sql` counts a `retire` marked W (`ball_retirement_dismissal()`, which
is `retirementDismissal()` in SQL) as a dismissal of `payload.batter` in `player_dismissals_since`, an innings of 0 (0),
out, in `player_innings` (a timed-out batter had no row), a batting match, and a line in the dismissal breakdown. It
is nobody's wicket and no ball in any bowling figure — those read `kind = 'ball'` and are unchanged. A W ball naming
timed out or retired out, and a `retire` with no W marker, read exactly as before. The live score, the handover check
and every device fold already counted it. The post-match report's key moments say "retired out" / "timed out".

## SQL agrees with the fold: the last four (db/43)

The fold is the truth and every SQL reader of `ball_event` agrees with it — db/40 (runs off the bat, non-ball wickets)
and db/42 (the free hit) made that the rule; `db/43_last_fold_disagreements.sql` closes the four disagreements db/40
wrote down and left:

| | The fold | SQL before db/43 | SQL now |
|---|---|---|---|
| **Who is out** | `dismissed ?? striker` over `fromRow()` — `dismissed` is `payload.dismissed` when toRow() could not put a player id in the column (a typed name) | `coalesce(dismissed_id, striker_id)`; `player_innings.out` only on the striker's row | `ball_dismissed_batter()`, in every reader of who is out: a batter run out at the non-striker's end is out on his own innings row (0 (0), out, if he never faced), and counts the match; a typed name run out at the far end is nobody here — never the striker |
| **The opposition's figures** | balls faced include no-balls, not wides; fours and sixes off the bat; the bowler is charged a wide's and a no-ball's penalty run | balls without no-balls; any ball worth four or six but a no-ball's byes; runs conceded without the penalty | as the fold, the same arithmetic as `player_batting_since` / `player_bowling_since` |
| **A ball with no type** | `type ?? "run"`: a legal ball, its runs the striker's and the bowler's | nothing — no ball, no run, though the live total counted its value | refused at the door (`ball_event_ball_has_type`); a stored one is read as a run by `ball_event_live` (`ball_type_as_folded()`), so every reader over it agrees |
| **A wicket with no method** | a wicket, the batter out, nobody's (`chargedToBowler(null)`), saved on a free hit | the bowler's wicket (`dismissal_is_bowlers(NULL)` was true) | nobody's; still saved on a free hit; refused at the door (`ball_event_wicket_has_method`) — the API has refused one since db/13 |

`payload.outAt` (SCRBRD-069) decides which end empties, never who is out, so no SQL reader needs it: each reads the
striker stamped on the ball. The door is a BEFORE INSERT trigger, `ball_event_names_its_delivery`, raising what a CHECK
would (23514, naming the rule), so the API refuses such an event on its own and names it (`value_refused`, with the
rule as `constraint`). It refuses and never rewrites: the write path fingerprints the event it holds (db/36), and a
row changed on its way in would never match its own resend. And it is not a CHECK, not even NOT VALID: `ball_event` is
append-only, its only UPDATEs are an owner's one-time backfills in a migration (db/13, db/36), and a CHECK is
re-checked on every row one touches. Rows stored before the door are read as the fold reads them, never corrected.

Still different, and each a decision for later: the matchups read's `balls` counts legal deliveries (a no-ball is not
one), which `tools/smoke-matchups.mjs` pins; a batter who came to the crease and neither faced nor was out has no
`player_innings` row (the fold lists him "0*"); and penalty runs are in the fold's total but not in
`match_live_score`'s — it reads `value`, which a `penalty` row does not carry (SCRBRD-090). The handover check had
both of the last problems and more; db/45 closed them for it, and db/48 closed the penalty runs for the live score
(both below).

`tools/smoke-fold-figures.mjs` holds the fold to every SQL reader of a batter's and a bowler's figures over generated
logs, legacy rows included; db/99 §21 holds each correction.

## The handover check counts this innings, as the fold does (db/45)

The incoming scorer reads the physical scoreboard and states runs, wickets and legal balls — the sheet asks for overs
and balls in the over and sends overs × 6 + balls. The scoreboard shows the innings being played, and the fold keeps
each innings' figures apart. `scoring_verify_takeover()` summed every innings of the match and read only `value`, so
from the second innings on, and after any penalty award, no honest statement could verify (SCRBRD-088).
`db/45_handover_this_innings.sql` makes it compare with the fold's figures for one innings:

- **Which innings** — the one the fold calls current: the highest innings number the live log has reached
  (`match_current_innings()`; `deriveMatch().current`; what `broadcast_state()` shows on the board). Not the innings
  of the highest seq: a ball released from quarantine into the first innings after the second began does not take
  the scoreboard back. Once the second innings' `innings_start` is written it is current, at 0/0 off 0, which is
  what both pads show; until then the first is. The client sends no innings and the signature is unchanged.
- **Runs** — a delivery's `value`, plus one for a wide or a no-ball, on deliveries only; plus each `penalty` row's
  `payload.runs`, 5 when absent or null (`ev.runs ?? 5`), and nothing when `payload.toBattingTeam` is `false`
  (`penalty_runs_as_folded()`). The fold does not add an award to the fielding side to this innings, and neither
  does the check; since db/48 both add it to the fielding side's own innings (below). A `runs` that is not an integer is a total the fold cannot make: the innings' runs are
  unknown, and nothing verifies.
- **Wickets** — a delivery whose wicket stands (the free hit, db/42), and a `retire` the fold reads as a dismissal
  (retired out, timed out: `ball_retirement_dismissal()`, db/40) — not any other row marked W.
- **Legal balls** — deliveries that are not wides or no-balls; a delivery with no type is a run (db/43).

`innings_score_as_folded(match, innings)` is that count, and runs as its caller. A mismatch's audit row names the
innings it was checked against. The reference double (`services/api/handover/scoring-session.mjs`,
`replayEvents()`) answers for the same innings. `tools/smoke-handover-innings.mjs` hands over through the API in the
first innings after a penalty and in the second after one each way; db/99 §23 holds each rule.

## Penalty runs to the fielding side cross innings (SCRBRD-094, db/48)

**Decided (Kameel, from MCC Law 41).** Five penalty runs awarded to the fielding side are added to the fielding side's
total: to its **most recently completed innings**, or, if it has not batted yet, to its **next innings**. The fold used
to drop them (`toBattingTeam: false` added to no innings).

**The event is unchanged.** A `penalty` is recorded in the innings being played when it was awarded, with
`toBattingTeam: false`; it names no other innings. `deriveInnings()` counts it in that innings' `penaltyToFielding`,
never in its `runs`. Where it goes is a question about the whole match, so the match folds answer it —
`deriveMatch()`, `deriveInningsList()` (the pad's shape: one log per innings) and `MatchFold` (the server's), all
through one function, `penaltyCredits()`:

| | Where the runs go | How the fold adds them |
|---|---|---|
| The fielding side has batted before this innings | its highest-numbered innings before this one — the most recently completed, since innings are played in order | **added at the end**, after its last event: its fall of wickets, partnerships and seal stand as recorded. Batting first and complete, their total rises mid-chase |
| It has not batted yet | its lowest-numbered innings after this one | **opened on**: in its total from before its first ball (`inningsFolder`'s `carried`), so its fall of wickets, the chase it completes and the figures a seal confirms include them. Batting second, they start on 5 |
| Its next innings is not in the log yet | nowhere until that innings' `innings_start` is written | `penaltyCredits().pending` lists it, so a screen can say the next innings opens on it |

Sides are the `innings_start`'s keys: an innings is the fielding side's when its `teamKey` equals this innings'
`bowlingTeamKey` (each falls back to the team's name). An innings with no keys is nobody's. Either way the runs are in
the receiving innings' `extras.penalty` and its `penaltyCarried`. Two-innings matches follow the same rule: in A, B, A, B
an award in B's second innings goes to A's second; with the follow-on (A, B, B, A) one in B's second goes to A's first.

**The target moves with it.** A chase's target is the other side's total plus one, so an award to the fielding side —
the side that set it — raises `inn.target` by the same runs, from the award on: the innings-over rule and the result
read the new figure (a chase of 11 that reaches 12 after a short run gave 5 to the fielding side is not over; the
margin is counted against 16). The target an innings opened with is taken to include every award made before it was
set (a pad folding the match stamps the credited total). A target the umpires typed (a `revision`) is theirs and does
not move; they revise it again. A chase with no stamped target is judged against the credited total plus one.

**Logs with no award to a fielding side replay identically** — `deriveInnings()`, `deriveMatch()` and `MatchFold`,
whole and event by event, over thousands of generated logs, against the fold before this change; the two new fields
are 0.

**Deliberate short running (Law 18.5.2, 41.5)** is two events, built by `shortRunning()`: the delivery as bowled with
no run completed (`value: 0`) and an award, reason `short_running`, to the fielding side. So the delivery needs nothing
new anywhere: no run to the side, the batter or the bowler; the batters at the ends they started from; a legal ball
of the over and a ball faced; a no-ball's or wide's one-run penalty stands. Every SQL reader of a delivery reads a dot
ball. The server takes the award only straight after a delivery of the same innings that scored no run
(`short_run_unmatched`), and takes it even when that delivery ended the match.

**The reasons are a closed list,** `PENALTY_REASON`, with words in `PENALTY_REASON_TEXT` and the side each award goes
to in `PENALTY_REASON_SIDE`:

| To the fielding side (the batting side's offence) | To the batting side (the fielding side's offence) | Either |
|---|---|---|
| `short_running` 41.5 · `obstruction_distraction` 41.4 · `pitch_damage` 41.12 · `protected_area` 41.14 · `striking_pitch` 41.15 · `time_wasting` 41.17 | `helmet_struck` 28.3 · `illegal_fielding` 28.2 · `ball_tampering` 41.3 · `fielding_time_wasting` 41.9 · `unfair_play` 41.1 · `fielding_restrictions` | `other` |

The batting side's reasons are the ones the pad's sheet already offered, under the Law each is. The pad's free text
from before the list closed is read as the reason it is (`normalisePenaltyReason`: "Deliberate time wasting" by the
side the runs went to); the constructor refuses anything else. At commit (`lawsRefusal`): runs that are not a whole
number above nought (`penalty_runs_invalid` — SCRBRD-090's last point), a reason not on the list
(`penalty_reason_unknown`), one awarded to the side that committed it (`penalty_reason_side`), and any award to the
fielding side but a short run's once the match is decided (`match_decided`: it would move a target nobody is chasing).

**SQL (db/48).** Every total that must agree with the fold now counts penalty runs as it does: `match_live_score`
(the awards to the batting side, and the credits — SCRBRD-090), `innings_score_as_folded()` and so the handover check,
and the board's target (`broadcast_state()` states `innings_target_as_folded()`, the fold's `inn.target`, else the
previous innings' credited total plus one). `penalty_credit_as_folded()` is `penaltyCredits()` in SQL. The live score
and derby reads follow the view. `tools/smoke-fold-figures.mjs` holds the fold to every one of them over generated logs
with awards to both sides; db/99 §25 holds each rule.
