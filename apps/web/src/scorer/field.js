import { ANGULAR_FAMILIES, SECTORS, batterSector, positionName, screenAngle, sectorOf, segFromScreenAngle } from "@scrbrd/scoring";
import { D, T, clr, themed } from "../design/tokens.js";

/* ═══════════════════════════════════════════════════════
   FIELD GEOMETRY
═══════════════════════════════════════════════════════ */
const CX=150,CY=150,R_IN=56,R_MID=104,R_BND=124,R_PITCH=13;

const toXY=(deg,r)=>[CX+r*Math.sin(deg*Math.PI/180),CY-r*Math.cos(deg*Math.PI/180)];

const ringArc=(cDeg,ro,ri)=>{
  const s=cDeg-15,e=cDeg+15;
  const[ax,ay]=toXY(s,ro);const[bx,by]=toXY(e,ro);
  const[cx,cy]=toXY(s,ri);const[dx,dy]=toXY(e,ri);
  return `M${cx} ${cy} L${ax} ${ay} A${ro} ${ro} 0 0 1 ${bx} ${by} L${dx} ${dy} A${ri} ${ri} 0 0 0 ${cx} ${cy} Z`;
};

const pieSlice=(cDeg,ro)=>{
  const s=cDeg-15,e=cDeg+15;
  const[ax,ay]=toXY(s,ro);const[bx,by]=toXY(e,ro);
  return `M${CX} ${CY} L${ax} ${ay} A${ro} ${ro} 0 0 1 ${bx} ${by} Z`;
};

/**
 * The twelve sector wedges, named by the engine's fielding families
 * (placement.mjs SECTORS) — one source of truth. The names typed here before
 * were about 30° off: "Mid On" at 90°, which is square leg, "Cover" at 270°,
 * which is point (SCRBRD-101).
 *
 * SEGS[i] is BATTER-RELATIVE sector i, drawn at `angle` on a right-hander's
 * field. A stored `seg` is the SCREEN's sector (what the scorer tapped), so a
 * word for a ball comes from sectorOf(ball, hand) — areaWords() below — and
 * never from SEGS[ball.seg].
 */
const cap=(s)=>s.charAt(0).toUpperCase()+s.slice(1);
const SEGS=SECTORS.map(s=>({id:s.seg,label:cap(s.label),angle:s.angle,side:s.side,key:s.key}));

/**
 * The frame a view draws in: the one hand its balls share, or a right-hander's
 * when they mix. Batter-relative data drawn per ball in its own batter's frame
 * puts a left-hander's cover drive on the leg-side label, so a view mixing
 * hands draws every ball as a right-hander's and says so (`mixed`).
 *
 * @param {string[]} hands  the hand of each ball in view
 * @returns {{hand: "R" | "L", mixed: boolean}}
 */
const frameOf=(hands)=>{
  const set=new Set(hands);
  if(set.size===1)return{hand:set.has("L")?"L":"R",mixed:false};
  return{hand:"R",mixed:set.size>1};
};

/**
 * The angle to DRAW a ball at.
 *
 * `ballHand` is the hand of the batter who played it; `frameHand` the hand
 * the view is laid out for (frameOf), which defaults to the ball's own.
 *
 * Point-era balls carry batter-relative theta and are mirrored for a
 * left-hander frame. Sector-era balls carry only the SCREEN sector the scorer
 * tapped, under the field as it was drawn for the batter who faced it: read
 * back to his own sector (batterSector), then laid out for the frame. In the
 * ball's own frame that is the wedge it was tapped in, unchanged.
 */
const ballAngle=(b,ballHand="R",frameHand=ballHand)=>{
  if(b?.theta!=null&&b?.placementSource==="point")return screenAngle(b.theta,frameHand);
  const own=batterSector(b?.seg,ballHand);
  return own==null?0:(batterSector(own,frameHand)??0)*30;
};

/** The screen wedge a ball falls in, in a view laid out for `frameHand`: the
 *  heat map's per-sector sum. Null for a ball with no placement. */
const frameSeg=(b,ballHand="R",frameHand=ballHand)=>{
  const own=sectorOf(b,ballHand);
  return own==null?null:batterSector(own,frameHand);
};

/**
 * The positions the rim names, from the engine's families (placement.mjs):
 * straight ones by their deep name — long on, long off — because a direction
 * on the rim is where the ball went to, and the rest by the family. At the
 * middle of each family's arc, batter-relative; mirror with screenAngle().
 */
const RIM_KEYS=["third","point","cover","mid_off","mid_on","mid_wicket","square_leg","fine_leg"];
const RIM=RIM_KEYS.map(key=>{
  const f=/** @type {{mid:number,label:string}} */(ANGULAR_FAMILIES.find(x=>x.key===key));
  const label=key==="mid_on"||key==="mid_off"?positionName(f.mid,1)??f.label:f.label;
  return{key,theta:f.mid,label:cap(label)};
});

/**
 * The wagon wheel's colours ARE the ball chips' (T.chip, DESIGN_DIRECTION
 * §3.9): a 1 is the pink the board draws a 1 in, a 4 the blue, and the
 * colour-vision palette moves both at once. A 5 takes the four's colour and
 * every extra — wide, no ball, bye, leg bye — the extras', as on the board.
 * The wicket and the dot keep the wheel's own (T.run.wicket, a muted ink).
 *
 * The chips were chosen for the black board, so on a daylight field most are
 * too pale to see. Each spoke is drawn on a casing of `T.field.casing` — the
 * board's black in daylight, the ground itself under lights — so the colour
 * sits on the ground it was chosen for (design.test.mjs measures both).
 */
const LK_COLS=themed(() => ({"1":T.chip.one,"2":T.chip.two,"3":T.chip.three,"4":T.chip.four,"5":T.chip.four,"6":T.chip.six,
  "0":D.textMuted,"W":T.run.wicket,"extras":T.chip.extra}));
/** The keys a legend offers, in the order a scorer reads them. A 5 is drawn
 *  in the four's colour and offered only when there is one. */
const LEGEND_KEYS=["1","2","3","4","6","0","W","extras"];

const lineKey=b=>{
  if(b.type==="W")return"W";
  if(b.type==="Wd"||b.type==="Nb"||b.type==="B"||b.type==="LB")return"extras";
  const v=b.value??0;
  if(v===0)return"0";
  if(v>=1&&v<=6)return String(v);
  return"4";
};

const ORDINAL={1:"First",2:"Second",3:"Third",4:"Fourth",5:"Fifth"};
/**
 * A captured point in words, as the pad says it the moment the tap lands:
 * "Deep mid-wicket", "Cover · boundary", "Second slip". The name is the
 * engine's (positionName), batter-relative, so it is right for either hand.
 * @param {{theta?:number|null,radius?:number|null,zone?:string|null}|null|undefined} p
 */
const placeWords=(p)=>{
  if(p?.theta==null||p.radius==null)return null;
  const n=positionName(p.theta,p.radius);
  if(n==null)return null;
  const slip=/^slip (\d)$/.exec(n);
  const w=slip?`${ORDINAL[/** @type {1|2|3|4|5} */(Number(slip[1]))]} slip`:n==="at feet"?"At the batter's feet":cap(n);
  return w+(p.zone==="boundary"?" · boundary":"");
};

/**
 * Where any recorded ball went, in words: its point's position, or its
 * sector — read through the hand of the batter who faced it — and band.
 * @param {object} b  a ball off the log
 * @param {string} [hand]  "R" | "L", the batter's who faced it
 */
const areaWords=(b,hand="R")=>{
  if(b?.placementSource==="point"&&b.theta!=null)return placeWords(b);
  const s=sectorOf(b,hand);
  if(s==null)return null;
  return SEGS[s].label+(b.zone==="boundary"?" · boundary":b.zone==="outer"?" · outfield":"");
};

/**
 * A tap on the 300×300 field, from client pixels: its screen angle (0 at the
 * top, clockwise) and its radius as a fraction of the rope, clamped to 1.00 —
 * a tap outside the rope is a six that cleared it. The input placementFromTap()
 * takes, for the Pro hub's wheel and the pad's Area step alike.
 * @param {number} clientX @param {number} clientY
 * @param {{left:number,top:number,width:number,height:number}} rect  the field's box
 */
const tapAt=(clientX,clientY,rect)=>{
  const x=((clientX-rect.left)/rect.width)*300-CX;
  const y=((clientY-rect.top)/rect.height)*300-CY;
  // Inverse of toXY: x = r·sin(a), y = -r·cos(a).
  return{angle:(Math.atan2(x,-y)*180/Math.PI+360)%360,radius:Math.min(Math.hypot(x,y)/R_BND,1)};
};

// Cool to hot, from the theme's own accents — so a hot sector reads on a
// day field as well as a night one. Alpha capped at 1: clr() writes two hex
// digits, and 1.13 of 255 is three.
const heatColor=(v,mx)=>{
  if(!mx||!v)return null;const t=v/mx;
  if(t<.25)return clr(D.emerald,Math.min(1,.22+t*2));
  if(t<.5) return clr(D.amber,Math.min(1,.3+t*1.2));
  if(t<.75)return clr(D.orange,Math.min(1,.38+t));
  return clr(D.rose,Math.min(1,.5+t*.5));
};

/**
 * Where a spoke ends.
 *
 * TWO ERAS, drawn differently and labelled honestly.
 *
 * POINT ERA — the line ends where the ball actually went. radius 1.00 is the
 * rope; a six that cleared it is drawn just beyond. This is the only case
 * where line length means distance.
 *
 * SECTOR ERA — there is no distance. There never was: length was synthesised
 * from the run value, so a lofted single and a scampered single drew the same
 * line, and a four along the ground and a four over cover drew the same line.
 * That is acceptable in a demo and must not be presented as measurement, so
 * these spokes are drawn at the SECTOR's nominal ring — inner, outer or
 * boundary — which is genuinely all that was recorded. `synthetic` is returned
 * with them so the render can mark them.
 *
 * What is NOT done: inventing a radius for a sector-era ball that looks like a
 * measured one. A fabricated point is indistinguishable from a captured one
 * downstream, which is exactly how a dataset stops being trustworthy.
 */
const wagEnd=(ang,b)=>{
  // Point era: the captured radius, in drawing units. 1.00 is the rope.
  if(b.radius!=null&&b.placementSource==="point"){
    const r=b.radius*R_BND;
    // A six that cleared the rope is shown fractionally beyond it, because
    // landing ON the boundary and landing over it are different balls.
    return{xy:toXY(ang,b.value===6?Math.max(r,R_BND)+9:r),synthetic:false};
  }
  // Sector era: the band, and nothing finer. No run-value length.
  const r=b.zone==="boundary"?R_BND-1:b.zone==="outer"?R_MID-14:R_IN-6;
  return{xy:toXY(ang,r),synthetic:true};
};

export { CX, CY, LK_COLS, LEGEND_KEYS, R_BND, R_IN, R_MID, R_PITCH, RIM, SEGS, areaWords, ballAngle, frameOf, frameSeg, heatColor, lineKey, pieSlice, placeWords, ringArc, tapAt, toXY, wagEnd };
