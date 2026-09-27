import { ball as ballEvent, noPlacement, NO_CONTACT_SHOTS, PLACEMENT_NULL, PLACEMENT_SOURCE, CAPTURE_PROFILE } from "@scrbrd/scoring";
import { shortRunEvents } from "./penalty.js";

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
 * fielding side.
 *
 * `placement` is the whole set of shot-placement fields, built by
 * placementFromTap() or noPlacement() — never assembled here. Callers that
 * pass a bare seg/zone (the three-phase pad's sector) get a sector; one with
 * neither (the one-tap pad, which never asks where the ball went) gets an
 * explicit "not required", or "no contact" for a shot the bat never touched.
 */
export function deliveryEvents({ curIn, before, freeHit, type, value, shot, seg, zone, approach, placement, shortRun = false, nbType = null }) {
  const place = placement ?? (seg != null
    ? { seg, zone, placementSource: PLACEMENT_SOURCE.SECTOR, captureProfile: CAPTURE_PROFILE.STANDARD }
    : noPlacement(
        NO_CONTACT_SHOTS.has(shot) ? PLACEMENT_NULL.NO_CONTACT : PLACEMENT_NULL.NOT_REQUIRED,
        CAPTURE_PROFILE.QUICK));
  const delivery = {
    type, value, shot, bowlerApproach: approach || null, freeHit,
    ...crease(before),
    ...place,
    // What kind of no-ball, as the no-ball sheet records it (a short run off
    // a no-ball asks it too).
    ...(type === "Nb" && nbType ? { nbType } : {}),
  };
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
