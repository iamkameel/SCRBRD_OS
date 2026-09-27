import { ball as ballEvent, noPlacement, NO_CONTACT_SHOTS, PLACEMENT_NULL, PLACEMENT_SOURCE, CAPTURE_PROFILE } from "@scrbrd/scoring";
import { shortRunEvents } from "./penalty.js";
import { disallowedEvents, notInOverEvents } from "./penalty.js";

/**
 * The events a delivery records — the pad's, built here and nowhere else.
 *
 * Moved out of engine.jsx (commitBall and the no-ball sheet's confirm) as
 * they were, line for line, so a test can build a delivery without the pad
 * around it (apps/web/test/pad-feel.test.mjs builds every extra the way the
 * pad recorded it before the two-tap extras and the way it records it now,
 * and holds the two to the same bytes). Nothing here decides anything the
 * engine did not: the engine still decides WHEN a delivery is recorded
 * (readiness, the handover lock) and what follows it.
 */

/**
 * WHO FACED IT, ON THE EVENT — for every delivery, not only the ones that
 * come through commitBall(). Taken from the innings BEFORE the ball: the
 * striker who faced it is the one there before it rotated them. The fold
 * never reads these (it tracks the crease itself); SQL careers do.
 */
export const crease = (i) => ({
  striker: i?.striker ?? null,
  nonStriker: i?.nonStriker ?? null,
  bowler: i?.bowler ?? null,
});

/**
 * A delivery through commitBall: one ball event, or — a short run
 * (SCRBRD-094) — the ball with every run disallowed and the five to the
 * fielding side. SCRBRD-113 adds, from the penalty sheet: `disallowed`, the
 * reason the runs were disallowed (short running, or a batter's further
 * offence on the pitch or in the protected area: runsDisallowed()); and
 * `notInOver`, the reason the delivery does not count in the over, with the
 * five to the batting side (notInOverDelivery()). `facesNext` is who was
 * chosen to face the next ball, where the Laws give the choice (FACES_NEXT);
 * none of the three is on the delivery unless given, so every other ball is
 * the event it always was.
 *
 * `placement` is the whole set of shot-placement fields, built by
 * placementFromTap() or noPlacement() — never assembled here. Callers that
 * pass a bare seg/zone (the three-phase pad's sector) get a sector; one with
 * neither (the one-tap pad, which never asks where the ball went) gets an
 * explicit "not required", or "no contact" for a shot the bat never touched.
 */
export function deliveryEvents({ curIn, before, freeHit, type, value, shot, seg, zone, approach, placement, shortRun = false, nbType = null,
  facesNext = null, disallowed = null, notInOver = null }) {
  const bowled = deliveryOf({ type, value, shot, approach, freeHit, crease: crease(before), seg, zone, placement, nbType });
  const delivery = facesNext ? { ...bowled, facesNext } : bowled;
  if (notInOver) return notInOverEvents(curIn, delivery, notInOver);
  if (disallowed) return disallowedEvents(curIn, delivery, disallowed);
  return shortRun ? shortRunEvents(curIn, delivery) : [ballEvent(delivery)];
}

/**
 * A no-ball, as the no-ball question records it. `nbRuns` only when the
 * scorer said byes or leg byes (SCRBRD-068); off the bat is the event's
 * default and is left off it. `selShot` and `selSeg` are the pro hub's shot
 * and sector (null on the pad). `nbType` is passed on as it always was;
 * ball() keeps only the fields the record has.
 */
export function noBallEvent({ inn, nbType, runs, nbRuns, selShot, selSeg }) {
  return ballEvent({type:"Nb",value:runs,shot:selShot,
    seg:selSeg?.seg??null,zone:selSeg?.zone??null,nbType,...(nbRuns?{nbRuns}:{}),
    ...crease(inn)});
}

/**
 * What a delivery records, before it becomes an event — the one funnel the
 * engine's commitBall() builds every ball through, taken out of the component
 * so it can be read, and tested, as the pure function it always was.
 *
 * `placement` is the whole set of shot-placement fields, built by
 * placementFromTap() or noPlacement() — never assembled by a caller. It
 * carries its own derived seg and zone, which is what keeps the point and the
 * sector it reduces to from drifting apart. A caller with a bare seg/zone (a
 * sector tap) gets a sector-era placement; one with neither (the one-tap pad,
 * which never asks where the ball went) gets an explicit "not required"
 * rather than a silent blank.
 *
 * @param {string | null | undefined} shot
 * @param {number | null | undefined} seg
 * @param {string | null | undefined} zone
 * @param {object | null | undefined} placement
 */
export function placementOf(shot, seg, zone, placement) {
  if (placement) return placement;
  if (seg != null) return { seg, zone, placementSource: PLACEMENT_SOURCE.SECTOR, captureProfile: CAPTURE_PROFILE.STANDARD };
  // A shot with no bat contact has nowhere to go, and that is a different fact
  // from a scorer skipping the step.
  return noPlacement(NO_CONTACT_SHOTS.has(/** @type {string} */ (shot)) ? PLACEMENT_NULL.NO_CONTACT : PLACEMENT_NULL.NOT_REQUIRED,
    CAPTURE_PROFILE.QUICK);
}

/**
 * The delivery commitBall() hands to ballEvent(): what was bowled, who was at
 * the crease, and where it went.
 * @param {{type: string, value: number, shot?: string | null, approach?: string | null, freeHit?: boolean,
 *          crease?: object, seg?: number | null, zone?: string | null, placement?: object | null}} d
 */
export function deliveryOf({ type, value, shot = null, approach = null, freeHit = false, crease = {}, seg = null, zone = null, placement, nbType = null }) {
  return {
    type, value, shot, bowlerApproach: approach || null, freeHit,
    ...crease,
    ...placementOf(shot, seg, zone, placement),
    // What kind of no-ball, as the no-ball sheet records it (a short run off
    // a no-ball asks it too).
    ...(type === "Nb" && nbType ? { nbType } : {}),
  };
}

/**
 * The pad's "Didn't travel" (SCRBRD-101): the scorer was asked where the ball
 * went and answered that it went nowhere. The innings is capturing points, so
 * the profile is `full`; the reason is NO_CONTACT when the shot never met the
 * bat (beaten, padded, off the body) and NOT_APPLICABLE otherwise — a block
 * that died at the feet has no direction to record. Never SKIPPED: the scorer
 * answered. Never a point at the feet: a point is never synthesised.
 * @param {string | null | undefined} shot
 */
export function didNotTravel(shot) {
  return noPlacement(NO_CONTACT_SHOTS.has(/** @type {string} */ (shot)) ? PLACEMENT_NULL.NO_CONTACT : PLACEMENT_NULL.NOT_APPLICABLE,
    CAPTURE_PROFILE.FULL);
}
