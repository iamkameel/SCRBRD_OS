# Shot placement: point capture

**Status:** implemented — steps 1–5 of §12. The continuous heat map (step 6) is not built.
**Implementation:** `packages/scoring/src/placement.mjs` · `db/07_shot_placement.sql` ·
capture in `apps/web/src/scorer/panels.jsx` · query layer in `services/api/read/read-api.mjs`
**Author:** drafted for SCRBRD / CricketOS
**Scope:** scoring input model, ball event schema, wagon wheel render eligibility
**Blocking:** continuous heat map render mode; true-distance analytics; ground-geometry integration

---

## 1. Why this exists

We currently capture shot placement as one of 36 discrete cells (12 segments × 3 zones). That resolution is enough for spoke wheels, sector totals and percentage splits. It is **not** enough for a continuous heat map, because a heat map's value comes from the position of a cluster, not from which of eight wedges it fell in.

This change is not retrofittable. A point can always be reduced to a sector; a sector can never be recovered as a point. Every ball scored before the cut-over is permanently sector-resolution. If the ball-by-ball dataset is the long-term asset, this should land before the Westville pilot rather than after it.

---

## 2. Current state (verified against `scrbrd_os.jsx`)

```js
const CX=150, CY=150, R_IN=56, R_MID=104, R_BND=124, R_PITCH=13;
const toXY=(deg,r)=>[CX+r*Math.sin(deg*Math.PI/180), CY-r*Math.cos(deg*Math.PI/180)];
```

A polar system already exists. `0°` is screen-up, which on our wheel is **behind the batter** — third man and fine leg. Straight down the ground toward the bowler is `180°`. Positive rotation is clockwise on screen, which for a right-hand batter is the leg side.

This matches the standard clock convention used in the canonical fielding-position diagram: 12 o'clock behind the batter, 6 o'clock down the ground, 3 o'clock square on the leg side for a right-hander.

```
theta = clock_hour × 30
```

Coaches already speak in clock positions. Worth surfacing both as a display convention and as an optional coarse input.

**Ball event shape today:**

```js
{ type, value, shot, seg, zone, bowlerApproach, over, ballInOver, striker, bowler }
```

`seg` is a segment index, `zone` is one of `inner` / `outer` / `boundary`.

**The problem, precisely.** `wagEnd(ang, b)` derives the rendered radius from the outcome:

```js
if (b.type==="W") r=28;
else if (b.value===6) r=R_BND+13;
else if (b.value===4||b.zone==="boundary") r=R_BND-1;
else if (b.value===3) r=R_MID-10;
...
```

Every line length on the current wheel is synthesised from the run value. No distance is measured or stored anywhere. This is acceptable in a demo and must not survive into a dataset we make claims about.

---

## 3. Proposed capture model

The scorer taps a **point** on the field graphic. We store polar coordinates, batter-relative.

### 3.1 Coordinate system

| Field | Type | Range | Meaning |
|---|---|---|---|
| `theta` | integer | `0`–`359` | Degrees clockwise from directly behind the batter (12 o'clock). `180` = straight down the ground. Positive = leg side, **regardless of handedness**. |
| `radius` | number | `0.00`–`1.00` | Fraction of the boundary distance at that bearing. `1.00` = the rope. |

Both are **batter-relative**, not screen-relative and not ground-relative. This is the single most important property of the model: it makes a ball comparable across venues, across pitch orientations, and across left- and right-handers without any transformation at query time.

### 3.2 Precision

Quantise on write. `theta` to whole degrees, `radius` to two decimals. Float noise implies precision we do not have and bloats the payload.

Realistic input error is roughly ±10–15° of bearing — the scorer is estimating from a boundary, not measuring. That is acceptable for heat maps with an appropriately wide kernel and unacceptable for any claim of ball-tracking accuracy. State this in any external material.

### 3.3 Handedness

`theta` is stored leg-side-positive. Rendering applies the mirror based on the striker's `batHand`:

- Right-hand batter: screen angle = `theta`
- Left-hand batter: screen angle = `360 - theta`

This resolves the existing defect where a left-hander's placement is stored against fixed segment angles and is silently wrong.

### 3.4 Normalised vs true distance

`radius` is normalised so that `1.00` means the rope at that bearing, whatever that ground's rope happens to be. True metres are **derived**, never stored on the ball:

```
distance_m = radius × boundary_distance_m(venue, pitch_bearing, theta)
```

Venue polygon and pitch bearing live on the venue and match records. Balls therefore stay venue-independent — a corrected polygon fixes the derived distances retroactively without touching a single ball.

---

## 4. Derived position naming

Position names are **derived from `theta` and `radius`, never stored**. The canonical fielding taxonomy decomposes exactly along our two axes: an angular family crossed with a depth qualifier.

| Axis | Source | Values |
|---|---|---|
| Angular family | `theta` | third · point · cover · mid off · mid on · mid-wicket · square leg · fine leg |
| Depth qualifier | `radius` | silly · short · (ring) · deep |

Deriving rather than storing means the naming table can be corrected, re-banded or localised later without touching a single ball.

**The table is not regular.** Build it once, carefully, from the canonical diagram:

- Straight positions break the pattern — `long off` / `long on`, not "deep mid off".
- `backward` denotes behind square and applies only to some families (backward point, backward square leg).
- Behind square on the leg side is crowded: short fine leg, deep fine leg, long leg and deep backward square leg occupy roughly 60°.
- Off side behind square is `third` in modern usage, not third man.
- Slips are ordinal, not a single position.

### 4.1 Close-catcher ring

Below the short band the outfield taxonomy is meaningless. This band gets its own position set:

`keeper` · `slip_1..n` · `gully` · `leg_slip` · `leg_gully` · `silly_point` · `short_leg` · `short_mid_wicket` · `at_feet`

Derived into `closePosition`. This band is where caught-behind dismissals and defended dots belong — neither currently has anywhere sensible to sit.

### 4.2 The 30-yard circle is venue-derived

Because `radius` normalises to the boundary, the fielding circle sits at a **different normalised radius at every ground** — roughly `0.50` at a 55m boundary, `0.40` at 68m. It must be computed from venue geometry, never hardcoded as a fixed band. This line carries fielding-restriction meaning, so it has to be right.

---

## 5. Cases with no placement

Placement is required whenever the bat made contact — including dots. It is **not applicable** where there is no stroke.

| Shot | Placement | Reason code |
|---|---|---|
| Any shot with bat contact | Required | — |
| `missed` | None | `no_contact` |
| `padded` | None | `no_contact` |
| `hit_body` | None | `no_contact` |
| Wide, no stroke offered | None | `not_applicable` |
| Profile does not require it | None | `not_required` |
| Required but scorer skipped | None | `skipped` |

The shot picker determines this, not the outcome. Balls with a `no_contact` shot commit straight from the shot stage and skip placement entirely — one fewer tap where placement would be meaningless.

---

## 6. Ball event schema

**Added:**

```js
{
  theta: 214,                  // int 0-359, leg-side positive, batter-relative
  radius: 0.72,                // 0.00-1.00, fraction of boundary at that bearing
  placementSource: "point",    // "point" | "sector" | null
  placementNull: null,         // null | "no_contact" | "not_applicable"
                               //      | "not_required" | "skipped"
  closePosition: null,         // set only when radius < 0.15
  captureProfile: "full"       // "full" | "standard" | "quick"
}
```

**Retained, now derived at write time:**

```js
{ seg, zone }
```

`seg` and `zone` continue to be written, computed from `theta` and `radius` as the ball is captured. This keeps every existing query, aggregate and render path working unchanged, and means point capture can ship without a simultaneous rewrite of the read side.

**Removed from the render path:** `wagEnd()`'s outcome-derived radius. Lines terminate at the captured point.

---

## 7. Scorer interaction

The tap is a tap. No extra step, no extra time.

- The field graphic accepts a tap anywhere within the boundary.
- Sector guide lines stay drawn as visual scaffolding — they orient the scorer and keep the interface familiar. They are **not** snap targets.
- **No snapping.** Snapping to a sector centroid destroys exactly the information this change exists to capture.
- On tap, the derived position name is echoed as confirmation text ("Deep cover"), so the scorer gets the same reassurance the sector model gave them.
- Optional drag-to-refine before commit. Release commits.
- A tap outside the boundary is a six that cleared the rope: clamp `radius` to `1.00`.

Placement-conditioned shot palette (specified separately) narrows the shot chips based on the captured `theta`, which is what keeps the total tap count at parity with today.

---

## 8. Coexistence with sector-era data

Two eras will live in the same career view indefinitely. They are distinguished by `placementSource`.

**Hard rule: never synthesise a point from a sector.** No centroid, no jitter, no random draw within the wedge. A fabricated point is indistinguishable from a captured one downstream and would poison the dataset permanently. Sector-era balls carry `placementSource: "sector"` and `theta: null`.

### Render mode eligibility

| Mode | Sector-era | Point-era |
|---|---|---|
| 1 · Spokes | Yes — synthesised length, flagged | Yes — true point |
| 2 · Sector totals | Yes | Yes (via derived `seg`) |
| 3 · Percentage split | Yes | Yes |
| 4 · Sector density | Yes | Yes |
| 5 · Continuous heat map | **No** | Yes |

A career heat map filters to `placementSource = 'point'` and states the excluded ball count. A career sector-total view uses everything. Both are honest; neither requires the user to understand the distinction unless they want to.

### Migration

There is no backfill. Cut-over is a date. Record the first point-era ball per player so coverage is reportable rather than inferred.

---

## 9. Query layer rules

Enforce in the query layer, not by convention in report code:

1. Continuous heat map requires `placementSource = 'point'`.
2. Any spatial aggregate requires `captureProfile IN ('full','standard')`.
3. Cross-player heat map comparison requires a shared fixed intensity scale — per-player normalisation makes every player look confident in their best area.
4. Below a sample floor, heat map degrades to sector density rather than rendering a wide-kernel blob from twelve balls.
5. Kernel width scales inversely with sample size.

---

## 10. What this unlocks

- Continuous heat maps by runs, balls faced, or runs per ball.
- Inverted: bowler concession maps, and team fielding maps that say where to put your best fielder.
- True carry distance on boundary balls, once venue polygons exist.
- Park-adjusted comparison across grounds with different boundary geometry.
- Honest spoke wheels, where line length means distance rather than run value.

---

## 11. Open decisions

1. **Radius above 1.00.** Cap at the rope, or allow up to ~1.4 to encode carry beyond it for sixes? Capping is simpler; allowing it is the only way to distinguish a six that just cleared from one that landed in the car park.
2. **Depth band boundaries.** Where silly ends and short begins, and short and ring. Should be set from real ground geometry, not picked. The ring/deep boundary is already answered — it is the fielding circle, which is venue-derived.
3. **Slip ordinals.** Whether the scorer distinguishes first from second slip, or whether we derive the ordinal from `theta` within the cordon.
4. **Precision claim.** What we say externally about accuracy. Recommend stating the input method plainly rather than quoting a figure.
5. **Cut-over timing.** Before the Westville pilot, or accept that pilot data is sector-era.

---

## 12. Sequencing

> **Landed.** 1–5 are done and covered by tests. Notes on what the code
> answered that the spec left open:
>
> - **§2's frame was verified against the running code, not assumed.** `0°` is
>   screen-up, behind the batter; `180°` is straight down the ground. `theta`
>   is therefore the same number the wheel already draws at for a right-hander,
>   and the mirror applies only to left-handers.
> - **§4.2 is honoured:** the fielding circle is computed from the venue's
>   boundary, never a fixed band. The same ball is in the ring at a 55m ground
>   and deep at a 68m one, and the tests assert exactly that.
> - **§11.1 (radius above 1.00)** is still open. Radius clamps at the rope per
>   §7, so a six that just cleared and one that landed in the car park are
>   currently the same ball.
> - **§11.2 (depth bands)** — `SILLY_MAX` and `SHORT_MAX` are named constants
>   with placeholder values, still to be set from real ground geometry. The
>   ring/deep boundary is answered by the circle.
> - **§11.3 (slip ordinals)** — derived from `theta` within the cordon rather
>   than asked for, so a later change to the arc re-labels the archive instead
>   of stranding it.
> - **§11.5 (cut-over timing)** is a decision for you, not the code. Point
>   capture is live; every ball scored from now is point-era.
>
> One thing found on the way: `ball_event.zone` was declared `smallint` while
> the client has always written `'inner'`/`'outer'`/`'boundary'`. Every ball
> carrying a placement would have been rejected with 22P02. Nothing caught it
> because no test had ever sent a zone.


1. Add fields to the ball event; write `theta` / `radius` as null. No behaviour change.
2. Derive `seg` / `zone` from point when present, fall back to direct capture when not.
3. Replace the sector tap with point capture in the scoring hub. Sector guides stay as scaffolding.
4. Remove `wagEnd()`'s outcome-derived radius from the spoke render.
5. Add `placementSource` filtering to the query layer.
6. Build the continuous heat map.

Steps 1–2 are non-breaking and can land independently. Step 3 is the cut-over.
