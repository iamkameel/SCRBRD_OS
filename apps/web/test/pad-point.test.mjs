/**
 * The three-phase pad captures a POINT (SCRBRD-101), and it is the event the
 * Pro hub's point path already records for the same tap.
 *
 * Both wheels are the one WagonWheel (panels.jsx): a tap becomes
 * placementFromTap({...tapAt(x, y, box), batHand}). The hub holds that
 * placement whole (onFieldSel) and records it with
 *     commitBall(type, value, shot, null, null, approach, placement)
 * and the pad now hands it to the engine the same way:
 *     onCommitDetailed(...padCommit(type, value, shot, area))
 *       → commitBall(type, value, shot, seg, zone, null, placement)
 * Every delivery is built by deliveryOf() (delivery.js). This test builds the
 * ball both ways, for the same tap, for each hand, and requires the two events
 * to be the same — then checks the engine's wiring is the one described, the
 * wicket keeps the point on both paths, "didn't travel" says why there is no
 * point, and the Laws check takes the ball the server will be sent.
 *
 * The browser walk (tools/smoke-browser-wagonwheel.mjs) does the same with
 * real taps against the API and compares the stored rows.
 *
 * Falsified: by padCommit() dropping the area (the pad's ball loses theta:
 * groups A and B red); by the engine's onCommitDetailed not forwarding it
 * (group C red); by confirmWicket spreading bare seg/zone again (group C red);
 * by didNotTravel() recording SKIPPED (group D red).
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/pad-point.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  ball as ballEvent, batters, bowler, deriveInnings, inningsStart, lawsRefusal, placementFromTap, positionName, sideOf, sectorOf, SECTORS,
  PLACEMENT_NULL, CAPTURE_PROFILE,
} from "@scrbrd/scoring";
import { deliveryOf, didNotTravel } from "../src/scorer/delivery.js";
import { tapAt } from "../src/scorer/field.js";
import { padCommit } from "../src/scorer/pad.jsx";
import { extraCall } from "../src/scorer/extras.js";

let pass = 0, fail = 0;
const ok = (n, c, why = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, why); } };
const group = (t) => console.log("\n" + t);
const src = (f) => readFileSync(new URL(`../src/scorer/${f}`, import.meta.url), "utf8");

/** An event without its clock: two events built a millisecond apart are the same event. */
const same = (a, b) => { const { clientTs: _a, ...x } = a; const { clientTs: _b, ...y } = b; return JSON.stringify(x) === JSON.stringify(y); };

// The field at 390 × 844: 332 px square, its top-left where the pad puts it.
const BOX = { left: 29, top: 400, width: 332, height: 332 };
// A tap on the screen's right, square of the wicket, well out: 150 px right of the middle.
const TAP = { x: BOX.left + 166 + 150, y: BOX.top + 166 };
const crease = { striker: "p1", nonStriker: "p2", bowler: "b1" };

/** The Pro hub's ball: onFieldSel(p) then onRun(value) → commitBall(..., hubApproach, selSeg). */
const hubBall = (selSeg, value, shot) => ballEvent(deliveryOf({ type: "run", value, shot, approach: null, freeHit: false, crease, seg: null, zone: null, placement: selSeg }));
/** The pad's ball: AreaPhase's onPlace(p) → area; commitRun(value) → onCommitDetailed(...padCommit()) → commitBall(..., null, placement). */
const padBall = (area, value, shot) => {
  const [type, v, s, seg, zone, placement] = padCommit("run", value, shot, area);
  return ballEvent(deliveryOf({ type, value: v, shot: s, approach: null, freeHit: false, crease, seg, zone, placement }));
};

group("A. The same tap is the same event, on the pad and on the hub");
for (const hand of ["R", "L"]) {
  const placed = placementFromTap({ ...tapAt(TAP.x, TAP.y, BOX), batHand: hand });
  const pad = padBall(placed, 4, "pull"), hub = hubBall(placed, 4, "pull");
  ok(`${hand}: the pad's ball equals the hub's, field for field`, same(pad, hub), `${JSON.stringify(pad)}\n   ${JSON.stringify(hub)}`);
  ok(`${hand}: ...and it carries the whole point`, pad.placementSource === "point" && pad.theta != null && pad.radius != null
     && pad.captureProfile === CAPTURE_PROFILE.FULL && pad.seg === placed.seg && pad.zone === placed.zone
     && pad.closePosition === placed.closePosition && pad.placementNull === null, JSON.stringify(pad));
}

group("B. What the tap on the screen's right means, for each hand");
{
  const r = padBall(placementFromTap({ ...tapAt(TAP.x, TAP.y, BOX), batHand: "R" }), 1, "flick");
  const l = padBall(placementFromTap({ ...tapAt(TAP.x, TAP.y, BOX), batHand: "L" }), 1, "cut");
  ok("the tap is square: 90° on the screen, radius 150/124 of the rope, clamped to 1", r.theta === 90 && r.radius === 1, `${r.theta} ${r.radius}`);
  ok("a right-hander's is square leg, on the leg side", /square leg/.test(String(positionName(r.theta, r.radius))) && sideOf(r.theta) === "leg");
  ok("a left-hander's is mirrored — theta 270 — his point, on the OFF side", l.theta === 270 && /point/.test(String(positionName(l.theta, l.radius))) && sideOf(l.theta) === "off");
  ok("both store the screen's sector, 3; read back for the batter it is square leg and point",
     r.seg === 3 && l.seg === 3 && SECTORS[/** @type {number} */ (sectorOf(r, "R"))].label === "square leg"
       && SECTORS[/** @type {number} */ (sectorOf(l, "L"))].label === "point");
}

group("C. The engine is wired the way this test assumes");
{
  const engine = src("engine.jsx").replace(/\s+/g, " ");
  ok("onCommitDetailed forwards the pad's placement to commitBall",
     /const onCommitDetailed=\(type,value,shot,seg,zone,placement\)=>\{[^}]*commitBall\(type,value,shot,seg,zone,null,placement\);/.test(engine));
  ok("the hub records its held point the same way", /commitBall\(effectiveType,value,hubShot,null,null,hubApproach,selSeg\)/.test(engine));
  ok("commitBall builds every delivery through deliveryEvents(), which is deliveryOf()",
     /const evs=deliveryEvents\(\{curIn,before,freeHit,type,value,shot,seg,zone,approach,placement,shortRun,nbType\}\);/.test(engine)
     && /const delivery = deliveryOf\(\{ type, value, shot, approach, freeHit, crease: crease\(before\), seg, zone, placement, nbType \}\);/.test(src("delivery.js")));
  ok("a wicket keeps the whole placement, from the pad (onWicketCtx) and the hub",
     /const onWicketCtx=\(shot,seg,zone,placement\)=>\{[^}]*placement:placement\?\?null/.test(engine)
       && /placement:selSeg\?\.placementSource\?selSeg:null/.test(engine)
       && /\.\.\.\(modalCtx\?\.placement\?\?\{seg:modalCtx\?\.seg\?\?null,zone:modalCtx\?\.zone\?\?null\}\)/.test(engine));
  const pad = src("pad.jsx").replace(/\s+/g, " ");
  ok("the pad's Area step captures with onPlace, not a sector's onSel", /<WagonWheel bare [^>]*onPlace=/.test(pad) && !/<WagonWheel bare [^>]*onSel=/.test(pad));
  ok("the pad commits through padCommit, runs and extras, and a wicket carries the area",
     /onCommitDetailed\(\.\.\.padCommit\(runType\(v\), v, shot, area\)\)/.test(pad)
       && /extraCall\(extra, n, \{ basic, shot, area, nb \}\)/.test(pad)
       && /\.\.\.\(area\?\.placementSource \|\| area\?\.placementNull \? \[area\] : \[\]\)/.test(src("extras.js"))
       && /onWicketCtx\(shot, area\?\.seg \?\? null, area\?\.zone \?\? null, area \?\? undefined\)/.test(pad));
  // A wicket event, as confirmWicket builds it, from each path's modalCtx.
  const placed = placementFromTap({ ...tapAt(TAP.x, TAP.y, BOX), batHand: "L" });
  const w = (ctx) => ballEvent({ type: "W", value: 0, shot: ctx.shot, ...(ctx.placement ?? { seg: ctx.seg, zone: ctx.zone }), dismissal: "caught", ...crease });
  ok("a caught ball keeps where it was caught, the same from either path",
     same(w({ shot: "cut", seg: placed.seg, zone: placed.zone, placement: placed }), w({ shot: "cut", seg: placed.seg, zone: placed.zone, placement: placed.placementSource ? placed : null }))
       && w({ shot: "cut", placement: placed }).theta === 270);
}

group("D. \"Didn't travel\" says why there is no point");
{
  const miss = didNotTravel("missed"), pad = didNotTravel("padded"), block = didNotTravel("fwd_def");
  ok("beaten or padded: no contact", miss.placementNull === PLACEMENT_NULL.NO_CONTACT && pad.placementNull === PLACEMENT_NULL.NO_CONTACT);
  ok("a block that died: not applicable — never skipped (the scorer answered)", block.placementNull === PLACEMENT_NULL.NOT_APPLICABLE);
  ok("the innings is capturing points: its profile is full", [miss, pad, block].every((p) => p.captureProfile === CAPTURE_PROFILE.FULL));
  ok("and no point is made up at the feet", [miss, pad, block].every((p) => p.theta === null && p.radius === null && p.placementSource === null && p.seg === null));
  const b = padBall(block, 0, "fwd_def");
  ok("the ball it records: no placement, the reason, full", b.placementNull === "not_applicable" && b.captureProfile === "full" && b.theta === null);
}

group("D2. A bye or leg bye after the Area step keeps the point (the two-tap extras meet point capture)");
{
  const placed = placementFromTap({ ...tapAt(TAP.x, TAP.y, BOX), batHand: "R" });
  const call = extraCall("LB", 1, { shot: "flick", area: placed });
  ok("the leg bye's commit carries the whole placement", call.to === "commit" && call.args[5] === placed, JSON.stringify(call.args));
  const [t, v, sh, seg, zone, placement] = call.args;
  const b = ballEvent(deliveryOf({ type: t, value: v, shot: sh, approach: null, freeHit: false, crease, seg, zone, placement }));
  ok("...and records the point, as the runs would", b.type === "LB" && b.theta === placed.theta && b.placementSource === "point");
  const legacy = extraCall("B", 2, { shot: null, area: { seg: 3, zone: "outer" } });
  ok("a bare sector is still a sector, exactly as before", legacy.args.length === 5 && legacy.args[3] === 3);
}

group("E. The Laws check takes a good point (SCRBRD-077)");
{
  const SQ = [{ id: "p1", name: "A", batHand: "L" }, { id: "p2", name: "B" }];
  const events = [inningsStart({ battingTeam: "H", bowlingTeam: "W", squad: SQ, overs: 20, captureProfile: "full" }),
    batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "b1" })];
  const view = { innings: [deriveInnings(events)], events: [events] };
  const good = padBall(placementFromTap({ ...tapAt(TAP.x, TAP.y, BOX), batHand: "L" }), 4, "cut");
  ok("a point from the pad is not refused", lawsRefusal(view, good) === null, JSON.stringify(lawsRefusal(view, good)));
  const nowhere = padBall(didNotTravel("fwd_def"), 0, "fwd_def");
  ok("nor is \"didn't travel\"", lawsRefusal(view, nowhere) === null);
  ok("...while a ball with no innings in play is (the check is live)", lawsRefusal({ innings: [] }, good) !== null);
}

console.log(`\n${"─".repeat(52)}\nPAD POINT SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
