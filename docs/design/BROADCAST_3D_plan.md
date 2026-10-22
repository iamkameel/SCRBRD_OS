# A live match on a three.js stage: the plan

**Status:** plan for future integration, written by the lead on 22 Oct 2026 at Kameel's request. Not a
design pass and not approved. Nothing here is built until Kameel decides §6. The immersive Match Centre and
the ground display are Fable's design problem (SCRBRD-133, CLAUDE.md), so anything past B1 goes to a Fable
pass first.

**Fits:** `docs/design/SCRBRD-133_immersive_match_centre.md` (§2 panels and rotation, §4 motion and the frame
budget, §5 moment cards), `docs/redesign/DESIGN_DIRECTION.md` (§1a "the pad is for speed, the board is for
emotion", §3.6 motion), `docs/policy/PUBLIC_DATA.md` (no child's name or likeness on a public page), and the
bundle ceilings in `tools/check-bundle.mjs`.

## 0 · In one page

A 3D view of the live match is mostly a matter of reusing what we already have. The investor pitch deck draws an
innings on a three.js field (`apps/web/src/views/pitchdeck/scene.js`), loaded in its own chunk, with named camera
views, a WebGL check, reduced motion and clean disposal. The scorer records each shot's direction and depth
relative to the boundary. What we do **not** record is ball tracking: no speed, no line and length, no flight. So
the honest 3D view is a **stylised replay**: the ball leaves the crease on the bearing the scorer tapped, travels
the fraction of the boundary the scorer gave, and arcs only when we know it went in the air. It is never a
Hawk-Eye claim.

Order: improve the flat charts first (B0, useful now and no new dependency), then a 3D "last ball" view in the
signed-in Match Centre (B1), then a broadcast panel on the ground display (B2), then the public page (B3).
Richer capture (B4) is a separate decision because it slows the scorer.

## 1 · What the code already gives us

**The stage (`views/pitchdeck/scene.js`, 315 lines; `three` ^0.186 is already a dependency):**
- Reached only through `import()`, so three.js is its own chunk and never in the entry or public graph.
- `webglAvailable()`; on no WebGL or a lost context (`onLost`) the screen falls back to the flat chart.
- `WebGLRenderer` at `powerPreference: "low-power"`, pixel ratio capped at 1.5, resized by `ResizeObserver`.
- Named cameras (`VIEWS`: orbit, low, wheel, far, close, top) eased with an exponential follow, not a timeline.
- `setReduced(true)` snaps the camera and stops the drift; `dispose()` frees every geometry and material.
- Its geometry is `scorer/field.js`'s, rope at radius 1: one idea of where mid-wicket is, shared with the pad.
- Its honesty rule: "the scene will not claim a distance for a ball that never had one."

**The data on each ball (`ball_event`, db/07):**
- `theta`: whole degrees from straight down the ground, positive to leg; `radius`: fraction of the boundary at
  that bearing. Both are venue-independent, so a corrected ground shape fixes every distance without touching a
  ball.
- `placement_source`: `point` (tapped) or `sector` (one of twelve). A sector ball is a fan, never a point.
- `placement_null`: why there is no placement (`no_contact`, `not_applicable`, `not_required`, `skipped`).
- `contact` (`middle`, the three edges, `beat`, `body`) and `trajectory` (`ground`, `aerial`,
  `controlled_aerial`, `miscued`; only off the bat). The scoring model, the API and the commentary read them,
  but **the pad does not ask for them today**, so most balls have neither.
- `close_position`, `shot`, the dismissal, and runs and extras from the fold.

**The live path:** the Match Centre's live read feeds both the Match Centre and the ground display
(`display/DisplayView.jsx`, with its panel rotation in `display/rotation.js`). Moments last 1.2 s for a four,
six or wicket and 1.5 s for a milestone or result (`matchcentre/live.js`), never covering the total. The
display's own Reduce motion setting sets `data-reduce-motion`, which `GLOBAL_CSS` turns into cuts.
SCRBRD-133 §4.4 designs, but phase G3 has not yet built, the arrival queue (`display/arrivals.js`: each new ball
one step, chip in, figures flip, chart extends) and the automatic guard (reduced motion for the session when two
chart animations in a row average under 20 frames a second). A 3D view needs both, so G3 comes first.

## 2 · What we can use now, without 3D (B0)

These improve the build whether or not 3D ever ships. Each is small and screen-only (Sonnet, Opus review).

1. **Draw what we know, and only that, on the flat wagon wheel.** A `point` ball is a spoke; a `sector` ball a
   faint fan across its sector; a ball with `placement_null` none at all, counted in a footnote ("6 balls not
   placed"). Today the difference between "tapped" and "estimated" is invisible.
2. **Encode trajectory where we have it:** a dashed spoke for aerial, solid for along the ground, a tick for an
   edge. Words in the table view and the spoken summary (GA-I31), never colour alone.
3. **Lift the stage's discipline into a shared helper** for every heavy visual (the worm, Manhattan, the ground
   display charts): WebGL or canvas checks with a flat fallback, a pixel-ratio cap, `ResizeObserver`,
   reduced-motion snap, disposal on unmount, and SCRBRD-133's 20-frames-a-second guard (designed, built here
   once for every chart). One helper instead of each chart re-learning it.
4. **Camera language for 2D:** the deck's named views become named zooms on the wagon wheel (the whole field;
   the batter's arc; the leg side), switched by the moment type, using `motion.panel` and a cut under reduced
   motion.
5. **One geometry:** keep `scorer/field.js` the only source of sector angles and ring radii for the wheel, the
   deck and any 3D view. A test asserts the three agree.

## 3 · The 3D view, in phases

| phase | where | what it shows | gate |
|---|---|---|---|
| **B1 · Last ball, in 3D** | signed-in Match Centre, a "3D" toggle beside the wagon wheel, off by default on phones | the last ball's path from the crease to its `theta`/`radius`; an arc for `aerial`/`miscued`; the camera picks a view by moment type (low behind the bowler for a four, high and wide for a six, close on the stumps for a wicket); the over so far as faint spokes | B0's helper; SCRBRD-133 G3's arrival queue; lazy chunk; Opus review of the honesty rules |
| **B2 · Broadcast panel** | the ground display, one panel in SCRBRD-133's rotation | the over's shots in turn, then the innings' field, slow orbit between balls, floodlit and daylight themes | a Fable pass on SCRBRD-133 (it changes the rotation and the 10-metre readability rules) |
| **B3 · Public live page** | `/live/*`, an opt-in button after the board has rendered | B1's view, with no names anywhere on the field | the public bundle ceiling (470 KB) untouched; `PUBLIC_DATA.md` reviewed by the information officer |
| **B4 · Richer capture** | the pad | pitch map (line and length), aerial or ground on every scoring shot | Kameel's call and a Fable pass: every extra tap slows the scorer, and the pad is for speed |

## 4 · Rules the 3D view must keep

- **No people.** No player models, faces, kits or names on the field. Fielders, if ever shown, are dots with a
  position name ("deep mid-wicket"), never a child's name, and not on a public page at all.
- **Never invent data.** No speed, no swing, no bounce. A `sector` ball is a fan; a ball with no placement is
  not drawn. A stylised arc is captioned as stylised.
- **The score comes first.** The board updates before any 3D step plays; a slow device drops to the flat view,
  never behind the score.
- **Never on the pad.** Motion lives on spectator surfaces only (`live.js`'s own rule).
- **Budgets:** three.js stays out of the entry (500 KB) and public (470 KB) graphs; under 20 frames a second
  the view goes flat for the session; `prefers-reduced-motion` gives cuts and no drift; nothing under 12 px or
  tapped under 44 px.
- **Corrections reach it:** the view reads the fold, so a voided ball disappears on the next read (GA-I36);
  no cached replay outlives a correction.

## 5 · Effort and routing

| phase | size | tier |
|---|---|---|
| B0 items 1–2 (wheel draws what we know) | S–M | Sonnet, Opus review |
| B0 item 3 (shared heavy-visual helper) | M | Sonnet, Opus review |
| B0 items 4–5 | S | Sonnet |
| B1 | M (about two days) | Sonnet builds from the stage; Opus reviews the honesty rules and the chunking |
| B2 | M, after a Fable pass | Fable design, then Sonnet, Opus review |
| B3 | S–M | Opus (public data and the bundle) |
| B4 | L | Fable design first; Kameel decides whether the pad asks more |

Timing: B0 can start after the weekly usage reset on Wed 28 Oct, in the gap analysis lane (it improves
GA-I28's shot wheel and GA-I31's chart tables). B1 follows B0. B2 and later wait for SCRBRD-133's own phases.

## 6 · Questions for Kameel

1. **Start with B0 (the flat wheel draws what we know) before any 3D?** *Recommendation:* yes; it is useful now,
   costs no dependency, and B1 stands on it.
2. **Where does 3D appear first?** *Recommendation:* the signed-in Match Centre (B1), not the ground display or
   the public page, so it is proven where only our own people see it.
3. **On phones, on by default?** *Recommendation:* no; a "3D" toggle, remembered per device, on by default only
   on screens 960 px and wider that pass the frame test.
4. **Ask the scorer for trajectory or line and length (B4)?** *Recommendation:* not before the pilot; decide
   from the pilot scorers' own pace, and only with a Fable pass on the pad.
