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

---

## Rules the engine implements that were already correct

Kept deliberately, listed so a future reader does not "fix" them back:

- **Wides and no-balls do not consume a ball of the over.** `isLegal()`.
- **Byes and leg byes are not charged to the bowler** but do count as balls
  bowled, and are balls faced by the batter.
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

## Adding a new scoring situation

Do not add a counter. Add an event kind in `events.mjs`, fold it in
`deriveInnings()`, and add the case to the test suite. If the new kind needs a
column the `ball_event` table does not have, put it in `payload` — `toRow()`
carries unknown fields there untouched, so capturing a new dimension never
requires a migration.
