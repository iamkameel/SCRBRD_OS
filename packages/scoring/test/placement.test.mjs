/**
 * Where the ball went, relative to the batter (SCRBRD-101).
 *
 * THE FRAME, checked rather than assumed. theta is clockwise from directly
 * behind the batter; the wheel draws the batter's end at the top and the
 * bowler's at the bottom, so 0° is the top of the screen and 90° its right.
 * A right-hander stands side-on with his left shoulder to the bowler, so he
 * faces the screen's LEFT: that is his off side, and the screen's right is
 * his leg side — theta 90 is square leg. A left-hander is the mirror.
 *
 *   A. the twelve sector names agree with angularFamily() at each centre
 *   B. batterSector(): the maths, its inverse, and the straight line
 *   C. placementFromTap() for a left-hander: the mirrored theta, the right
 *      position name, the right side, and a stored seg that stays the
 *      screen's
 *   D. sectorOf(): a point reads its theta, a sector its seg and the hand —
 *      and the 15° lines where the two roundings differ
 *
 * Falsified: A by naming sector 3 "mid on" again; B by dropping the mirror
 * for "L"; C by storing the batter-relative seg from placementFromTap(); D by
 * reading a point's stored seg instead of its theta.
 *
 *   node packages/scoring/test/placement.test.mjs
 */
import {
  ANGULAR_FAMILIES, SECTORS, SIDE, angularFamily, batterSector, closePositionFor, placementFromTap, positionName,
  screenAngle, sectorOf, segFromScreenAngle, sideOf,
} from "../src/index.mjs";

let pass = 0, fail = 0;
/** @type {(n: string, c: unknown, detail?: unknown) => void} */
const ok = (n, c, detail) => {
  if (c) pass++;
  else { fail++; console.log("  ✗", n, detail === undefined ? "" : `\n      ${String(detail).slice(0, 300)}`); }
};
const group = (/** @type {string} */ t) => console.log("\n" + t);

group("A. Every sector is named by the family at its centre");
{
  ok("twelve sectors, 30° apart, from 0°", SECTORS.length === 12 && SECTORS.every((s, i) => s.seg === i && s.angle === i * 30));
  for (const s of SECTORS) {
    const fam = ANGULAR_FAMILIES.find((f) => f.key === angularFamily(s.angle));
    ok(`sector ${s.seg} (${s.angle}°) is ${fam?.label}`, s.key === fam?.key && s.label === fam?.label, `${s.label} / ${fam?.label}`);
  }
  // The names the old lists gave, each of which was wrong by about 30°.
  const named = Object.fromEntries(SECTORS.map((s) => [s.angle, s.label]));
  ok("90° is square leg, not mid on", named[90] === "square leg");
  ok("30° is fine leg, not square leg", named[30] === "fine leg");
  ok("120° is mid-wicket, not long on", named[120] === "mid-wicket");
  ok("210° is mid off, not long off", named[210] === "mid off");
  ok("240° is cover, not mid off", named[240] === "cover");
  ok("270° is point, not cover", named[270] === "point");
  ok("300° is backward point, not point", named[300] === "backward point");
  ok("the leg side is 30°–150°, the off side 210°–330°, and 0° and 180° neither",
     SECTORS.every((s) => s.side === (s.angle === 0 || s.angle === 180 ? SIDE.STRAIGHT : s.angle < 180 ? SIDE.LEG : SIDE.OFF)));
  ok("sideOf: 1° leg, 179° leg, 181° off, 359° off, 0 and 180 straight, null null",
     sideOf(1) === "leg" && sideOf(179) === "leg" && sideOf(181) === "off" && sideOf(359) === "off"
       && sideOf(0) === "straight" && sideOf(180) === "straight" && sideOf(360) === "straight" && sideOf(null) === null);
}

group("B. batterSector(): a stored (screen) seg, relative to the batter");
{
  ok("a right-hander's screen is his frame: every seg is itself",
     Array.from({ length: 12 }, (_, s) => batterSector(s, "R")).every((v, s) => v === s));
  ok("a left-hander's is (12 − seg) mod 12",
     Array.from({ length: 12 }, (_, s) => batterSector(s, "L")).join() === "0,11,10,9,8,7,6,5,4,3,2,1");
  // Why: screen sector s is at 30s; his theta there is 360 − 30s (thetaFromScreen).
  ok("...which is the sector of the theta he has there, for every seg",
     Array.from({ length: 12 }, (_, s) => s).every((s) => batterSector(s, "L") === segFromScreenAngle(screenAngle(s * 30, "L") ?? -1)));
  ok("...its own inverse", Array.from({ length: 12 }, (_, s) => s).every((s) => batterSector(batterSector(s, "L"), "L") === s));
  ok("...and the straight line does not move: behind him and down the ground", batterSector(0, "L") === 0 && batterSector(6, "L") === 6);
  ok("the screen's 90° (square leg for a right-hander) is a left-hander's point", SECTORS[/** @type {number} */ (batterSector(3, "L"))].label === "point");
  ok("no seg, or one out of range, is no sector", batterSector(null) === null && batterSector(12, "L") === null
     && batterSector(-1) === null && batterSector(2.5) === null);
  ok("an unrecorded hand reads as right-handed", batterSector(3) === 3);
}

group("C. placementFromTap() for a left-hander");
{
  // The same spot on the screen — its right, square, well out — for each hand.
  const tap = { angle: 90, radius: 0.7 };
  const r = placementFromTap({ ...tap, batHand: "R" });
  const l = placementFromTap({ ...tap, batHand: "L" });
  ok("a right-hander's theta is the screen angle", r.theta === 90);
  ok("a left-hander's is mirrored: 360 − 90 = 270", l.theta === 270);
  ok("the right-hander's is square leg", positionName(r.theta, r.radius) === "deep square leg", positionName(r.theta, r.radius));
  ok("the left-hander's is point", positionName(l.theta, l.radius) === "deep point", positionName(l.theta, l.radius));
  ok("leg side for him, off side for the other", sideOf(r.theta) === "leg" && sideOf(l.theta) === "off");
  ok("the stored seg stays the SCREEN's for both: 3", r.seg === 3 && l.seg === 3);
  ok("...and reads back as his own sector, point, through sectorOf", SECTORS[/** @type {number} */ (sectorOf(l, "L"))].label === "point");
  // Close in: a left-hander's off side is the screen's right, so his slips
  // are behind him to the right, where a right-hander has his leg slip.
  const slip = placementFromTap({ angle: 15, radius: 0.06, batHand: "L" });
  ok("a left-hander's catch just right of behind the keeper is a slip", /^slip_\d$/.test(String(closePositionFor(slip.theta, slip.radius))),
     `${slip.theta} ${closePositionFor(slip.theta, slip.radius)}`);
  ok("...where a right-hander's is leg slip", closePositionFor(placementFromTap({ angle: 15, radius: 0.06 }).theta, 0.06) === "leg_slip");
  ok("a left-hander's cover drive, tapped at the screen's 120°, is his cover", positionName(placementFromTap({ angle: 120, radius: 0.35, batHand: "L" }).theta, 0.35) === "cover");
}

group("D. sectorOf(): the batter's sector, from whatever the ball carries");
{
  ok("a sector-era ball: its seg, through the hand", sectorOf({ seg: 3, placementSource: "sector" }, "L") === 9
     && sectorOf({ seg: 3, placementSource: "sector" }, "R") === 3);
  ok("a ball with no placement has no sector", sectorOf({ seg: null }, "L") === null && sectorOf(null) === null);
  // On a 15° line the screen's rounding and the mirror's differ: a
  // left-hander's theta 345 is on the screen at 15, which rounds to sector 1
  // — and 12 − 1 is 11, where his own theta rounds to 0.
  const edge = placementFromTap({ angle: 15, radius: 0.5, batHand: "L" });
  ok("on a 15° line a point reads its theta, not the seg derived from the screen",
     edge.theta === 345 && edge.seg === 1 && sectorOf(edge, "L") === 0 && batterSector(edge.seg, "L") === 11,
     JSON.stringify({ theta: edge.theta, seg: edge.seg, sectorOf: sectorOf(edge, "L") }));
  ok("...and every point agrees with its theta's sector, either hand",
     [0, 7, 15, 44, 90, 165, 181, 270, 344, 359].every((a) => ["R", "L"].every((h) => {
       const p = placementFromTap({ angle: a, radius: 0.5, batHand: h });
       return sectorOf(p, h) === segFromScreenAngle(p.theta);
     })));
}

console.log(`\n${"─".repeat(52)}\nPLACEMENT SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
