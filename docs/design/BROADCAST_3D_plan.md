# A live match on a three.js stage: the plan

**Status:** plan for future integration, written by the lead on 22 Oct 2026 at Kameel's request. Not a
design pass and not approved. Nothing here is built until Kameel decides §7. The immersive Match Centre and
the ground display are Fable's design problem (SCRBRD-133, CLAUDE.md), so anything past B1 goes to a Fable
pass first.

**Fits:** `docs/design/SCRBRD-133_immersive_match_centre.md` (§2 panels and rotation, §4 motion and the frame
budget, §5 moment cards), `docs/redesign/DESIGN_DIRECTION.md` (§1a "the pad is for speed, the board is for
emotion", §3.6 motion), `docs/policy/PUBLIC_DATA.md` (no child's name or likeness on a public page), and the
bundle ceilings in `tools/check-bundle.mjs`.

## 0 · In one page

§6 reads Kameel's `iamkameel/3D_SCRBRD` repository: it carries a broadcast UI kit's design notes and a school
colour engine, but no 3D code. Its best idea, school colours held as approved data, is taken; its hard-coded
"verified" colour list and silent recolouring are not.

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

## 6 · What `iamkameel/3D_SCRBRD` offers (read 22 Oct, commit 46ba814)

That repository is an older copy of parts of SCRBRD (its `tokens.js` and write routes are behind main), plus
an AI Studio "Athletic Broadcast UI Kit" hand-off (`public/assets/aistudio/*.md`) and one new module,
`src/design/schoolIdentityEngine.js` (588 lines). It holds **no three.js broadcast code**: the kit's own roadmap
says the 3D export was never available, and `scrbrd-3d-os-full-backup.tar.gz` is an HTML page, not an archive.
The kit's interactive files (`SCRBRD_UI_KIT_INTERACTIVE.html`, `src/brand.mjs`, `src/react/ScoreStrip.tsx`, the
branding schema, the preview images) are named but not in the repository.

**Take, adapted to our rules:**

1. **A school's colours are data, approved and versioned.** SCRBRD has no school colour or crest model today.
   The kit's hierarchy (school brand revision → team kit variant → the fixture's resolved identity) is right:
   colours stored per school with who approved them and when, scoped to the component that shows that school,
   never a page-wide theme and never a semantic colour (danger, live, win). This is a schema change (Opus) and a
   school-facing approval step; it is also what B2's broadcast panel and the ground display need to show two
   schools fairly.
2. **One ink at both ends of a team ramp.** A flat left-to-right gradient from the approved colours, with one
   text colour reaching 4.5:1 at both ends, adjusting the *display* ramp, never the stored colour. Our
   `tokens.js` already has `contrast()`, `inkOn()` and `luminance()`; the kit's `adjustForContrast()` (walk HSL
   lightness until the ratio holds) is the one helper to add.
3. **A clash warning, not a recolour.** When two schools' colours are close (the kit uses ΔE76 under 22 as a
   rough screen), keep both and add the difference another way: crest, name, an outline or a pattern.
4. **Score strip conventions for the board:** the batting side's colour on the score and the striker, the
   fielding side's on the bowler's figures; one shared capsule for the two batters with a small striker marker;
   team names wide and uppercase, batter names condensed, score figures tabular; overs as legal balls (`28.3`);
   a wicket or milestone takeover only after the event is recorded, and never over the scorer.
5. **A definition of done per component:** default, hover, focus, active, selected, disabled, loading, empty,
   error, permission denied, offline, reduced motion and phone. Ours (the floors in CLAUDE.md and the walks)
   already covers most; empty, permission denied and offline should be checked on every new screen.

**Leave out:**

- **The hard-coded `VERIFIED_SCHOOL_BRANDS` list** (17 real schools with colours, mottos and venues). Nothing
  shows a school approved them, and the kit's own notes say never to call an inferred colour official. Colours
  come from each school, through the approval step in item 1.
- **The automatic away-kit swap** in `resolveMatchupClash()`. It silently recolours one school when colours are
  close, which the kit's own architecture forbids; item 3 replaces it.
- **Writing team colours onto `:root`** (`applySchoolAndMatchupTokensToRoot`). A coach's screen can show several
  schools at once; colours are scoped to the component.
- **New font families** (Inter Display, Noto Sans Display Condensed, Barlow Condensed) without Kameel's say:
  each is a download on every phone and counts against the bundle and public page budgets. We already ship Syne
  and DM Sans; a condensed face for batter names is the one worth testing.
- **Player photography and FOX-styled artwork:** no child's photograph or likeness on a public page, and no
  broadcaster's marks.

## 7 · Questions for Kameel

1. **Start with B0 (the flat wheel draws what we know) before any 3D?** *Recommendation:* yes; it is useful now,
   costs no dependency, and B1 stands on it.
2. **Where does 3D appear first?** *Recommendation:* the signed-in Match Centre (B1), not the ground display or
   the public page, so it is proven where only our own people see it.
3. **On phones, on by default?** *Recommendation:* no; a "3D" toggle, remembered per device, on by default only
   on screens 960 px and wider that pass the frame test.
4. **Ask the scorer for trajectory or line and length (B4)?** *Recommendation:* not before the pilot; decide
   from the pilot scorers' own pace, and only with a Fable pass on the pad.
5. **School colours as approved data (§6 item 1)?** *Recommendation:* yes, after the pilot: a school's office
   enters its colours and crest, the school approves them, and only then do they appear on the board, the ground
   display and the public page. Until then, our neutral board. Nothing from the hard-coded list.
6. **The score strip conventions (§6 item 4) on the Board and the ground display?** *Recommendation:* yes, with
   neutral colours until item 5 exists; a Sonnet job with Opus review, folded into SCRBRD-133's remaining phases.

**Decided 22 Oct 2026 (Kameel): as recommended, all six.**
