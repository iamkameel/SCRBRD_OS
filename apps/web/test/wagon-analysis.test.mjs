/**
 * The wagon-wheel analysis panel's counting rules (SCRBRD-102):
 * scorer/wagonAnalysis.mjs, over hand-built balls rather than a folded
 * innings, so each rule is checked in isolation from the fold and the wheel.
 *
 * Every ball below is the shape sectorOf() and ballArea() read: `theta` for a
 * measured point (placementSource "point"), `seg` alone for a sector-era
 * guess. Angles are BATTER-RELATIVE (placement.mjs's frame), so a
 * left-hander's cover sits at the same theta as a right-hander's — the
 * mirror is in `seg` for a sector-era ball, not in theta.
 */
import {
  AREAS, CHIP_VALUES, ballArea, chipKeyOf, filterBalls, isPlaced, wagonAnalysis,
} from "../src/scorer/wagonAnalysis.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

/** A point-era ball at a batter-relative theta. */
const pt = (theta, value, extra = {}) => ({ type: "run", value, theta, radius: 0.7, placementSource: "point", ...extra });
/** A sector-era ball: only the screen seg it was tapped at. */
const seg = (s, value, extra = {}) => ({ type: "run", value, seg: s, ...extra });

group("AREAS: eight named areas, four a side, RIM's own words");
ok("eight areas, none blank", AREAS.length === 8 && AREAS.every((a) => a.label && a.key));
ok("four off, four leg", AREAS.filter((a) => a.side === "off").length === 4 && AREAS.filter((a) => a.side === "leg").length === 4);
ok("the off four, in SCRBRD-102's order", AREAS.filter((a) => a.side === "off").map((a) => a.key).join(",") === "third,point,cover,mid_off");
ok("the on four, in SCRBRD-102's order", AREAS.filter((a) => a.side === "leg").map((a) => a.key).join(",") === "fine_leg,square_leg,mid_wicket,mid_on");
ok("long off and long on take positionName's deep words, not the ring name", AREAS.find((a) => a.key === "mid_off").label === "Long off"
   && AREAS.find((a) => a.key === "mid_on").label === "Long on");

group("ballArea: a right-hander's cover drive, point era");
ok("235° is cover, off side", JSON.stringify(ballArea(pt(235, 4), "R")) === JSON.stringify({ sector: 8, area: "cover", side: "off" }));
ok("straight down the ground (180°) is neither side", ballArea(pt(180, 0), "R").area === null && ballArea(pt(180, 0), "R").side === null);
ok("dead behind (0°) is neither side either", ballArea(pt(0, 1), "R").area === null);

group("ballArea: the two backward sectors fold into their square neighbour");
ok("backward point (290°) reads as point", ballArea(pt(290, 2), "R").area === "point" && ballArea(pt(290, 2), "R").side === "off");
ok("backward square leg (55°) reads as square leg", ballArea(pt(55, 1), "R").area === "square_leg" && ballArea(pt(55, 1), "R").side === "leg");

group("ballArea: sector-era balls, read through the hand that played them");
// Screen sector 8 sits at 240°, the screen's cover — but batterSector(8,"L")
// = (12-8)%12 = 4, a left-hander's OWN sector 4 (120°, mid-wicket): the tap a
// left-hander made toward the screen's cover was actually behind square on
// his own leg side, which is exactly what the mirror rule says it should be.
ok("a left-hander's screen-cover tap is his own mid-wicket", JSON.stringify(ballArea(seg(8, 3), "L")) === JSON.stringify({ sector: 4, area: "mid_wicket", side: "leg" }));
// The same tap read for a right-hander stays at his own sector 8: cover.
ok("...the same seg for a right-hander stays cover", ballArea(seg(8, 3), "R").area === "cover");
ok("a null seg and no theta has no sector at all", JSON.stringify(ballArea({ type: "run", value: 1 }, "R")) === JSON.stringify({ sector: null, area: null, side: null }));

group("chipKeyOf and isPlaced");
ok("1 through 6 except 5 keep their own key", ["1","2","3","4","6"].every((v) => chipKeyOf({ value: Number(v) }) === v));
ok("5 folds into 4's chip", chipKeyOf({ value: 5 }) === "4");
ok("0, a wicket and an unscored ball have no chip", chipKeyOf({ value: 0 }) === null && chipKeyOf({ type: "W", value: 0 }) === null && chipKeyOf({}) === null);
ok("CHIP_VALUES is the five SCRBRD-102 names, in order", CHIP_VALUES.join(",") === "1,2,3,4,6");
ok("a captured point is placed", isPlaced(pt(90, 1)));
ok("a sector-era seg is placed", isPlaced(seg(3, 1)));
ok("neither is not placed", !isPlaced({ type: "run", value: 1 }));

group("filterBalls: batter, bowler, match — null means don't filter");
const F = [
  { strikerId: "a", bowlerId: "x", matchId: "m1", value: 1 },
  { strikerId: "a", bowlerId: "y", matchId: "m1", value: 2 },
  { strikerId: "b", bowlerId: "x", matchId: "m2", value: 4 },
];
ok("no filter is everything", filterBalls(F).length === 3);
ok("by batter alone", filterBalls(F, { batterId: "a" }).length === 2);
ok("by bowler alone", filterBalls(F, { bowlerId: "x" }).length === 2);
ok("by match alone", filterBalls(F, { matchId: "m2" }).length === 1);
ok("batter and bowler together", filterBalls(F, { batterId: "a", bowlerId: "y" }).length === 1);
ok("a combination matching nothing is empty, not everything", filterBalls(F, { batterId: "a", matchId: "m2" }).length === 0);

group("wagonAnalysis: chips, sides, areas and what got left out — a right-hander's innings");
// cover (235°, off, 4 runs, boundary), point (265°, off, 1), long off (200°,
// off, 6, boundary), square leg (90°, leg, 2), a dot at mid-wicket (120°,
// leg, 0), a wicket (no runs, still placed), a leave (no placement at all),
// and one dead straight (180°, 0) that belongs to neither side.
const innings = [
  pt(235, 4), pt(265, 1), pt(200, 6), pt(90, 2), pt(120, 0),
  { type: "W", value: 0, theta: 210, radius: 0.3, placementSource: "point" },
  { type: "run", value: 0 },                    // no placement: a leave
  pt(180, 0),                                    // dead straight: neither side
];
const a = wagonAnalysis(innings, { batHandFor: () => "R" });
ok("chips.all counts every PLACED ball, wicket and all, not the leave", a.chips.all === 7);
ok("one each of 1, 2, 4, 6, and no 3s", a.chips["4"] === 1 && a.chips["6"] === 1 && a.chips["2"] === 1 && a.chips["1"] === 1 && a.chips["3"] === 0);
ok("off side runs: cover 4 + point 1 + long off 6 = 11", a.sides.off.runs === 11);
ok("leg side runs: square leg 2 + mid-wicket 0 = 2", a.sides.leg.runs === 2);
ok("shares add to 100 over the classified total (11 and 2 of 13)",
   a.sides.off.pct === 84.6 && a.sides.leg.pct === 15.4);
ok("cover carries its run and its boundary", a.areas.find((x) => x.key === "cover").runs === 4 && a.areas.find((x) => x.key === "cover").boundaries === 1);
ok("an area nothing went to is zero, not missing", a.areas.find((x) => x.key === "fine_leg").runs === 0 && a.areas.find((x) => x.key === "fine_leg").boundaries === 0);
ok("one leave is unplaced, one ball is dead straight — both left out, both counted", a.excluded.unplaced === 1 && a.excluded.straight === 1);
ok("with no chip, every placed ball is shown", a.shown.length === a.chips.all);
ok("tapping the 4s chip shows only the one four", wagonAnalysis(innings, { batHandFor: () => "R", chip: "4" }).shown.length === 1);

group("wagonAnalysis: an all-sector-era, all-left-handed innings still reads correctly");
const lhInnings = [seg(8, 4), seg(9, 1), seg(3, 2)];   // screen cover(4), screen point(1), screen square leg(2)
const lh = wagonAnalysis(lhInnings, { batHandFor: () => "L" });
// batterSector(8,"L")=4 (mid-wicket, leg, 4 runs), batterSector(9,"L")=3 (square leg, leg, 1 run),
// batterSector(3,"L")=9 (point, off, 2 runs): every tap reads through the LEFT-hander's own sector.
ok("every ball reads through the left-hander's own sector, not the screen's", lh.sides.leg.runs === 5 && lh.sides.off.runs === 2);

group("Falsification: two edits that should each break a specific assertion")
console.log("  (see the report for the two edits made and reverted by hand)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
