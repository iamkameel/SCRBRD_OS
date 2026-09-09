/**
 * The wagon wheel's drawing rule.
 *
 * Placements are stored BATTER-RELATIVE (see placement.mjs) and mirrored at
 * render, which is what makes a left-hander's cover drive comparable with a
 * right-hander's without rewriting a single stored ball. The corollary is easy
 * to get wrong and was: the mirror has to be resolved from the batter who
 * PLAYED each ball, not from whoever happens to be at the crease when someone
 * opens the screen.
 *
 * THE DEFECT THIS PINS DOWN
 * ─────────────────────────
 * The wheel drew a whole innings with one handedness, taken from the current
 * striker. So a right-hander's cover drive was drawn at mid-wicket — the
 * opposite side of the ground — for as long as a left-hander was on strike,
 * and it jumped back across the field the moment the strike rotated. The same
 * ball, two positions, depending on when you looked. Nothing about the stored
 * data was wrong; the render re-introduced exactly the defect the
 * batter-relative frame exists to prevent.
 *
 * The assertions below are about SIDES OF THE GROUND rather than exact pixels:
 * a ball hit to the off side must never be drawn on the leg side, which is the
 * failure that matters and the one a coach would notice.
 */
import { deriveInnings, batHandOf, screenAngle } from "@scrbrd/scoring";
import { CX, CY, ballAngle, toXY, wagEnd } from "../src/scorer/field.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

/** Which side of the ground a drawn ball ends up on, from its geometry alone. */
const sideOf = (angle, radius = 0.8) => {
  const [x] = toXY(angle, radius * 100);
  return x > CX ? "leg-for-RH" : x < CX ? "off-for-RH" : "straight";
};

// A side with one of each, which is every side.
const SQUAD = [
  { id: "righty", name: "R Hand", batHand: "R" },
  { id: "lefty", name: "L Hand", batHand: "L" },
];

/** theta 215° is through the covers for a right-hander — off side, in front. */
const COVERS = 215;

const mixedInnings = () => deriveInnings([
  { kind: "innings_start", overs: 20, squad: SQUAD, bowlingSquad: [] },
  { kind: "batters", striker: "righty", nonStriker: "lefty" },
  { kind: "bowler", bowler: "b1" },
  // The right-hander drives through the covers, twice, staying on strike.
  { kind: "ball", type: "run", value: 2, theta: COVERS, radius: 0.8, placementSource: "point", seq: 1 },
  // A single rotates the strike…
  { kind: "ball", type: "run", value: 1, theta: COVERS, radius: 0.8, placementSource: "point", seq: 2 },
  // …and now the LEFT-hander plays the same batter-relative shot, which is a
  // mirror image on the ground.
  { kind: "ball", type: "run", value: 2, theta: COVERS, radius: 0.8, placementSource: "point", seq: 3 },
]);

group("A. The frame itself");
{
  ok("a right-hander's theta is the angle it draws at", screenAngle(COVERS, "R") === COVERS);
  ok("a left-hander's is mirrored about the straight line", screenAngle(COVERS, "L") === 360 - COVERS);
  ok("...and mirroring twice is the identity", screenAngle(screenAngle(COVERS, "L"), "L") === COVERS);
  ok("the covers are the off side for a right-hander", sideOf(screenAngle(COVERS, "R")) === "off-for-RH");
  ok("...and the mirror puts a left-hander's version on the other side",
     sideOf(screenAngle(COVERS, "L")) === "leg-for-RH");
}

group("B. Every ball is drawn for the batter who played it");
{
  const inn = mixedInnings();
  ok("the log records who faced each ball",
     inn.ballLog.map((b) => b.strikerId).join(",") === "righty,righty,lefty");
  ok("the left-hander is on strike at the end, which is what made this a trap",
     inn.striker === "lefty");

  // Per ball — the fix.
  const drawn = inn.ballLog.map((b) => sideOf(ballAngle(b, batHandOf(inn, b.strikerId))));
  ok("the right-hander's two drives are drawn on the off side",
     drawn[0] === "off-for-RH" && drawn[1] === "off-for-RH");
  ok("the left-hander's mirror image is drawn on the other side",
     drawn[2] === "leg-for-RH");

  // THE ASSERTION THAT MATTERS. One handedness for the whole innings — the
  // way it used to be drawn — puts the right-hander's shots on the wrong side
  // of the ground, and this proves the difference is not cosmetic.
  const oneHand = batHandOf(inn);            // "L": whoever is on strike now
  const naive = inn.ballLog.map((b) => sideOf(ballAngle(b, oneHand)));
  ok("drawing the innings with a single handedness moves real shots across the field",
     naive[0] !== drawn[0] && naive[1] !== drawn[1]);
  ok("...and it is the right-hander's balls that end up wrong",
     naive[0] === "leg-for-RH" && drawn[0] === "off-for-RH");
  ok("...while the batter on strike is the one it happens to get right",
     naive[2] === drawn[2]);
}

group("C. Sector-era balls have no handedness to apply");
{
  // Before point capture there was no theta — only a wedge. A wedge is already
  // a position on the ground, so mirroring it would move a recorded ball.
  const b = { seg: 9, zone: "outer", value: 1, type: "run" };
  ok("a sector ball draws at its wedge regardless of who faced it",
     ballAngle(b, "R") === ballAngle(b, "L"));
  ok("...at the wedge's own nominal angle", ballAngle(b, "R") === 270);
}

group("D. Distance is drawn only where distance was recorded");
{
  const point = { theta: COVERS, radius: 0.5, placementSource: "point", value: 1, type: "run" };
  const sector = { seg: 9, zone: "outer", value: 1, type: "run" };
  ok("a captured point is not marked synthetic", wagEnd(215, point).synthetic === false);
  ok("a sector-era ball is", wagEnd(270, sector).synthetic === true);
  // The sector era never recorded distance: length came from the run value, so
  // a lofted single and a scampered single drew the same line. Drawing them at
  // the band is the honest answer, and marking them lets the render say so.
  const near = wagEnd(270, { ...sector, value: 1 });
  const far = wagEnd(270, { ...sector, value: 3 });
  ok("...and two sector balls in the same band draw the same length, whatever they scored",
     near.xy[0] === far.xy[0] && near.xy[1] === far.xy[1]);
  // Landing ON the rope and clearing it are different balls, so the six is
  // drawn fractionally further out. Measured as distance from the middle
  // rather than as a coordinate: at 180° the y axis increases outward, and an
  // earlier version of this assertion had the comparison backwards while
  // reading perfectly well.
  const out = (b) => { const [x, y] = wagEnd(180, b).xy; return Math.hypot(x - CX, y - CY); };
  const onTheRope = { theta: 180, radius: 1, placementSource: "point", value: 4, type: "run" };
  ok("a six that cleared the rope is drawn beyond it",
     out({ ...onTheRope, value: 6 }) > out(onTheRope));
}

console.log(`\n${"─".repeat(52)}\nWHEEL SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
