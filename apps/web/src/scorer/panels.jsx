import { useState, useEffect, useMemo, useRef } from "react";
import { batHandOf, chargedToBowler, normaliseDismissal, placementFromTap, screenAngle, suspensionWords } from "@scrbrd/scoring";
import { deriveCommentary } from "@scrbrd/scoring/commentary";
import { rulesOf } from "@scrbrd/scoring";
import { nameBook } from "../lib/matchCentre.js";
import { D, T, clr, inkOn, px, textOn } from "../design/tokens.js";
import { can } from "../rbac/index.js";
import { CX, CY, LEGEND_KEYS, LK_COLS, R_BND, R_IN, R_MID, R_PITCH, SEGS, areaWords, ballAngle, frameOf, frameSeg, heatColor, lineKey, pieSlice, ringArc, tapAt, toXY, wagEnd } from "./field.js";
import { FieldLabels, MIRROR_NOTE, fieldSentence } from "./fieldLabels.jsx";
import { RR, fmtOv, SR } from "./format.js";
import { buildNarratives, buildSignals } from "./signals.js";
import { ALL_SHOTS_FLAT, fetchAICommentary } from "./shots.js";
import { Badge, BallDot, Card, Lbl, SignalBar } from "./ui.jsx";
import { Icon } from "../ui/icons.jsx";
import { isSuperOver, pairPlace, superOverCommentary, superOverTitle } from "../lib/superOver.js";


/* ═══════════════════════════════════════════════════════
   WAGON WHEEL
═══════════════════════════════════════════════════════ */
/**
 * @param batHand handedness of the batter AT THE CREASE NOW. Used for
 *   capture: a tap belongs to whoever is facing, and its theta is stored
 *   relative to them. While capturing, the field is laid out for him.
 * @param handFor handedness of the batter who played a GIVEN ball, resolved
 *   per ball. Defaults to `batHand` for every ball, which is correct only
 *   while one batter has faced the whole log.
 * @param onPlacing called with the point under the finger while it is down
 *   (and null when it lifts), so the Area step can name the position as the
 *   tap lands.
 *
 *   These are different questions and conflating them was a real defect.
 *   Placements are stored batter-relative and mirrored at render, so drawing a
 *   whole innings with the current striker's handedness put every ball a
 *   left-hander faced on the wrong side of the ground. Each ball is read with
 *   its own batter's hand and drawn in the FRAME of the field on screen
 *   (SCRBRD-101): the striker's while capturing, so every spoke sits under
 *   the OFF and LEG the scorer is reading. See placement.mjs.
 */
// `bare`: the field alone, as wide as its column allows — the pad's Area
// phase (step 2 of the redesign), where the heat toggle and the legend are
// not what the scorer is being asked.
function WagonWheel({ballLog=[],selSeg,onSel,onPlace,onPlacing,viewMode,onViewMode,hidden,onToggle,batHand="R",handFor,bare=false}){
  const handOf=handFor??(()=>batHand);
  // A live point being placed, before commit. Drag refines it; release commits.
  const [placing,setPlacing]=useState(null);
  const svgRef=useRef(null);

  /**
   * A tap anywhere on the field becomes a point.
   *
   * NO SNAPPING. The sector guides stay drawn because they orient the scorer
   * and keep the interface familiar, but they are scaffolding, not targets —
   * snapping to a wedge centroid would destroy exactly the information this
   * capture exists to record.
   *
   * A tap outside the rope is a six that cleared it, so radius clamps to 1.00.
   */
  const pointFromEvent=(e)=>{
    const svg=svgRef.current;
    if(!svg)return null;
    const t=e.touches?.[0]??e.changedTouches?.[0]??e;
    return placementFromTap({...tapAt(t.clientX,t.clientY,svg.getBoundingClientRect()),batHand});
  };
  const place=(p)=>{setPlacing(p);onPlacing?.(p);};
  const[hov,setHov]=useState(null);
  // The frame: the striker's while capturing (the tap is his), else the one
  // hand the log shares, else a right-hander's with the left-handers mirrored.
  const placed=ballLog.filter(b=>b.seg!=null||b.theta!=null);
  const frame=onPlace?{hand:batHand==="L"?"L":"R",mixed:false}:frameOf(placed.map(b=>handOf(b)));
  const angleOf=b=>ballAngle(b,handOf(b),frame.hand);
  // Runs per wedge as the field on screen shows them: each ball's own sector,
  // relative to its batter, laid out for the frame.
  const segRuns=Array(12).fill(0);
  placed.forEach(b=>{const s=frameSeg(b,handOf(b),frame.hand);if(s!=null)segRuns[s]+=(b.value||0);});
  const maxR=Math.max(...segRuns,1);
  const isSel=id=>selSeg?.seg===id;
  const zoneFill=(id,zone)=>{
    const sel=isSel(id),hv=hov?.seg===id;
    if(viewMode==="heatmap")return heatColor(segRuns[id],maxR)||"transparent";
    if(sel&&selSeg.zone===zone)return clr(D.indigo,.38);
    if(sel)return clr(D.indigo,.14);
    if(hv)return clr(D.sky,.12);
    return"transparent";
  };
  // A ball with neither a captured point nor a sector has no position at all
  // — a leave, a ball that hit the pad — and belongs on no wheel.
  const visLines=placed.filter(b=>!hidden.has(lineKey(b)));
  // How many of these were captured as points rather than sectors. Shown
  // rather than hidden: a wheel mixing eras should say so.
  const pointCount=visLines.filter(b=>b.placementSource==="point").length;
  // The legend offers a 5 only when there is one; it is drawn in the four's colour.
  const legend=LEGEND_KEYS.flatMap(k=>k==="4"&&placed.some(b=>lineKey(b)==="5")?["4","5"]:[k]);
  const at=(p)=>toXY(/** @type {number} */(screenAngle(p.theta,batHand)),p.radius*R_BND);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"11px"}}>
      {!bare&&<div style={{display:"flex",alignItems:"center",gap:"8px"}}>
        <Lbl>Field Map</Lbl>
        <div style={{marginLeft:"auto",display:"flex",gap:"2px",background:D.surf3,borderRadius:D.pill,padding:"3px"}}>
          {["wagon","heatmap"].map(m=>(
            <button key={m} onClick={()=>onViewMode(m)} className="pressBtn" style={{
              minHeight:"44px",padding:"4px 15px",borderRadius:D.pill,border:"none",cursor:"pointer",
              background:viewMode===m?D.grad:"transparent",
              color:viewMode===m?T.light.ink:D.textMuted,
              fontFamily:T.type.body,fontSize:"12px",fontWeight:700,letterSpacing:"0.04em",
              textTransform:"uppercase",transition:"all .25s",
            }}>{m==="wagon"?"Wheel":"Heat"}</button>
          ))}
        </div>
      </div>}
      <div data-testid="wagon-wheel" data-frame={frame.hand} style={{position:"relative",width:"100%",maxWidth:bare?"min(100%, 332px)":"272px",margin:"0 auto",aspectRatio:"1",userSelect:"none"}}>
        <svg ref={svgRef} viewBox="0 0 300 300" style={{width:"100%",height:"100%",display:"block"}}
          data-testid="wagon-field"
          role={onPlace?"application":"img"}
          aria-label={onPlace
            ?`Field. Tap where the ball went. ${fieldSentence(frame.hand)}`
            :`Wagon wheel, ${visLines.length} balls${pointCount?`, ${pointCount} placed exactly`:""}. ${fieldSentence(frame.hand,frame.mixed)}`}>
          <defs>
            <radialGradient id="gOuter" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={T.field.grass}/><stop offset="100%" stopColor={T.field.grassEdge}/>
            </radialGradient>
            <radialGradient id="gInner" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={T.field.square}/><stop offset="100%" stopColor={T.field.squareEdge}/>
            </radialGradient>
            <filter id="glow"><feGaussianBlur stdDeviation="2.5" result="blur"/>
              <feComposite in="SourceGraphic" in2="blur" operator="over"/></filter>
          </defs>
          <circle cx={CX} cy={CY} r={R_BND+3} fill="url(#gOuter)"/>
          {SEGS.map(seg=>{
            const sel=isSel(seg.id),hv=hov?.seg===seg.id;
            const fill=viewMode==="heatmap"?(heatColor(segRuns[seg.id],maxR)||`${D.amber}0d`):sel?clr(D.indigo,.42):hv?clr(D.sky,.16):`${D.amber}0c`;
            const stroke=sel?clr(D.indigo,.7):hv?clr(D.sky,.4):`${D.amber}25`;
            return(<path key={`b${seg.id}`} d={ringArc(seg.angle,R_BND,R_MID)} fill={fill} stroke={stroke}
              strokeWidth={sel?"1.5":"0.5"} style={{cursor:onPlace?"crosshair":"pointer",pointerEvents:onPlace?"none":"auto"}}
              onClick={()=>onSel?.(sel&&selSeg?.zone==="boundary"?null:{seg:seg.id,zone:"boundary"})}
              onMouseEnter={()=>setHov({seg:seg.id})} onMouseLeave={()=>setHov(null)}/>);
          })}
          <circle cx={CX} cy={CY} r={R_MID} fill="none" stroke={`${D.amber}50`} strokeWidth="1.5" strokeDasharray="4 3"/>
          {SEGS.map(seg=>(
            <path key={`o${seg.id}`} d={ringArc(seg.angle,R_MID,R_IN)} fill={zoneFill(seg.id,"outer")}
              stroke={isSel(seg.id)?clr(D.indigo,.35):T.field.hairline} strokeWidth="0.4" style={{cursor:onPlace?"crosshair":"pointer",pointerEvents:onPlace?"none":"auto"}}
              onClick={()=>onSel?.(isSel(seg.id)&&selSeg?.zone==="outer"?null:{seg:seg.id,zone:"outer"})}
              onMouseEnter={()=>setHov({seg:seg.id})} onMouseLeave={()=>setHov(null)}/>
          ))}
          <circle cx={CX} cy={CY} r={R_IN} fill="url(#gInner)" stroke={T.field.rule} strokeWidth="1" strokeDasharray="3 4"/>
          {SEGS.map(seg=>(
            <path key={`i${seg.id}`} d={pieSlice(seg.angle,R_IN)} fill={zoneFill(seg.id,"inner")}
              stroke={isSel(seg.id)?clr(D.indigo,.25):T.field.hairline} strokeWidth="0.4"
              style={{cursor:onPlace?"crosshair":"pointer",pointerEvents:onPlace?"none":"auto"}}
              onClick={()=>onSel?.(isSel(seg.id)&&selSeg?.zone==="inner"?null:{seg:seg.id,zone:"inner"})}
              onMouseEnter={()=>setHov({seg:seg.id})} onMouseLeave={()=>setHov(null)}/>
          ))}
          {SEGS.map(seg=>{const[xo,yo]=toXY(seg.angle-15,R_BND);return(
            <line key={`sp${seg.id}`} x1={CX} y1={CY} x2={xo} y2={yo} stroke={T.field.hairline} strokeWidth="0.5" style={{pointerEvents:"none"}}/>
          );})}
          {viewMode==="wagon"&&visLines.map((b,i)=>{
            const{xy:[ex,ey],synthetic}=wagEnd(angleOf(b),b);
            const key=lineKey(b),col=LK_COLS[key];
            const w=b.value===6?2.5:b.value===4?2:1.2;
            const op=b.value===0?0.25:0.72;
            // Sector-era spokes are dashed. Their length is the band the ball
            // was recorded in, not a distance anyone measured, and a solid
            // line beside a captured one would claim otherwise. Each spoke
            // sits on a casing (T.field.casing): the chip colours were chosen
            // for the black board, and in daylight the grass is not black.
            const anim={animationDelay:`${i*.02}s`};
            return(<g key={`wl${i}`} style={{pointerEvents:"none"}} data-spoke={key} data-colour={col}>
              <line x1={CX} y1={CY} x2={ex} y2={ey} stroke={T.field.casing} strokeWidth={w+1.6}
                strokeDasharray={synthetic?"2 2":undefined} opacity={op} strokeLinecap="round" className="wagonLine" style={anim}/>
              <line x1={CX} y1={CY} x2={ex} y2={ey} stroke={col} strokeWidth={w}
                strokeDasharray={synthetic?"2 2":undefined} opacity={op} strokeLinecap="round" className="wagonLine" style={anim}/>
            </g>);
          })}
          {viewMode==="wagon"&&visLines.filter(b=>b.value>=4).map((b,i)=>{
            const{xy:[ex,ey]}=wagEnd(angleOf(b),b);
            const col=LK_COLS[lineKey(b)];
            return(<circle key={`dt${i}`} cx={ex} cy={ey} r={b.value===6?5.5:4} fill={col} opacity="0.95"
              stroke={T.field.casing} strokeWidth="0.8"
              style={{pointerEvents:"none",filter:b.value===6?"url(#glow)":"none"}}/>);
          })}
          {/* The capture surface. One transparent circle covering the whole
              field including beyond the rope, so a tap anywhere lands — the
              sector paths underneath keep their hover and selection behaviour
              only when point capture is off. */}
          {onPlace&&(
            <circle cx={CX} cy={CY} r={150} fill="transparent" style={{cursor:"crosshair"}} data-testid="wagon-capture"
              onPointerDown={(e)=>{e.currentTarget.setPointerCapture?.(e.pointerId);place(pointFromEvent(e));}}
              onPointerMove={(e)=>{if(placing)place(pointFromEvent(e));}}
              onPointerUp={(e)=>{const p=pointFromEvent(e)??placing;place(null);if(p)onPlace(p);}}
              onPointerCancel={()=>place(null)}/>
          )}
          {/* The live point, and the line to it. Shown before commit so the
              scorer can see what they are about to record and drag to refine. */}
          {placing&&(
            <g style={{pointerEvents:"none"}}>
              <line x1={CX} y1={CY} x2={at(placing)[0]} y2={at(placing)[1]}
                stroke={D.sky} strokeWidth="1.6" strokeLinecap="round" opacity="0.85"/>
              <circle cx={at(placing)[0]} cy={at(placing)[1]} r="5" fill={D.sky} opacity="0.95"/>
            </g>
          )}
          <rect x={CX-4.5} y={CY-R_PITCH} width={9} height={R_PITCH*2} rx="2.5" fill={T.field.pitch} stroke={`${D.amber}60`} strokeWidth="0.7" style={{pointerEvents:"none"}}/>
          <line x1={CX-6} y1={CY-R_PITCH+3} x2={CX+6} y2={CY-R_PITCH+3} stroke={T.field.mark} strokeWidth="0.8" style={{pointerEvents:"none"}}/>
          <line x1={CX-6} y1={CY+R_PITCH-3} x2={CX+6} y2={CY+R_PITCH-3} stroke={T.field.mark} strokeWidth="0.8" style={{pointerEvents:"none"}}/>
          {[-2.8,0,2.8].map(x=>[
            <circle key={`st${x}`} cx={CX+x} cy={CY-R_PITCH+1.5} r="1.4" fill={T.field.stumps} style={{pointerEvents:"none"}}/>,
            <circle key={`sb${x}`} cx={CX+x} cy={CY+R_PITCH-1.5} r="1.4" fill={T.field.stumps} style={{pointerEvents:"none"}}/>
          ])}
          {viewMode==="heatmap"&&SEGS.map(seg=>{
            if(!segRuns[seg.id])return null;
            const[lx,ly]=toXY(seg.angle,(R_IN+R_MID)/2+12);
            return(<text key={`hr${seg.id}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fontSize="12" fontFamily="'DM Mono',monospace" fontWeight="500"
              fill={T.field.figure} style={{pointerEvents:"none"}}>{segRuns[seg.id]}</text>);
          })}
        </svg>
        <FieldLabels hand={frame.hand}/>
      </div>
      {frame.mixed&&<p data-testid="wheel-mirror-note" style={{margin:0,textAlign:"center",fontFamily:T.type.body,fontSize:"12px",lineHeight:1.4,color:T.content.secondary}}>{MIRROR_NOTE}</p>}
      {!bare&&<div style={{display:"flex",justifyContent:"center",gap:"5px",flexWrap:"wrap"}}>
        {legend.map(k=>{
          const col=LK_COLS[k],off=hidden.has(k);
          return(<button key={k} onClick={()=>onToggle(k)} className="pressBtn" style={{
            minHeight:"44px",display:"flex",alignItems:"center",gap:"5px",padding:"4px 12px",borderRadius:D.pill,
            cursor:"pointer",background:off?"transparent":`${col}12`,
            border:`1px solid ${off?D.border:`${col}38`}`,opacity:off?0.3:1,transition:"all .2s",
          }}>
            <div style={{width:"12px",height:"2px",borderRadius:"2px",background:off?D.textMuted:col}}/>
            <span style={{color:off?D.textMuted:D.textSecondary,fontSize:"12px",fontFamily:T.type.body,fontWeight:600,letterSpacing:"0.03em"}}>{LEGEND_WORD[k]??k}</span>
          </button>);
        })}
      </div>}
    </div>
  );
}
const LEGEND_WORD={"0":"Dot","W":"Wicket","extras":"Extras"};

/* ═══════════════════════════════════════════════════════
   INTEL PANEL
═══════════════════════════════════════════════════════ */
function IntelPanel({inn,overs,target,isChase}){
  const[idx,setIdx]=useState(0);
  const[auto,setAuto]=useState(true);const[lastOver,setLastOver]=useState(null);
  const timer=useRef(null);
  useEffect(()=>{
    if(!inn)return;
    const comp=inn.overLog.filter(o=>o.balls.length===6);
    if(comp.length>0){const lat=comp[comp.length-1];if(lat!==lastOver)setLastOver(lat);}
  },[inn?.overLog]);
  const sig=buildSignals(inn,overs,target,isChase);
  const cards=buildNarratives(sig,lastOver);
  useEffect(()=>{
    if(!auto||cards.length===0){clearInterval(timer.current);return;}
    timer.current=setInterval(()=>setIdx(p=>(p+1)%Math.max(1,cards.length)),6200);
    return()=>clearInterval(timer.current);
  },[auto,cards.length]);
  useEffect(()=>setIdx(0),[cards.length]);
  const phaseCol=sig?.phase==="POWERPLAY"?D.emerald:sig?.phase==="MIDDLE"?D.amber:D.orange;
  if(!sig||cards.length===0)return(
    <Card style={{padding:"18px 20px"}}>
      <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"10px"}}>
        <div style={{width:"8px",height:"8px",borderRadius:"50%",background:D.indigo}}/>
        <Lbl>Match Intelligence</Lbl>
      </div>
      <div style={{color:D.textMuted,fontSize:"13px",fontFamily:D.body,lineHeight:1.5}}>Intelligence builds as the match develops…</div>
    </Card>
  );
  const card=cards[Math.min(idx,cards.length-1)];
  return (
    <div style={{borderRadius:D.lg,overflow:"hidden",position:"relative",
      background:`linear-gradient(145deg,${D.surf1},${D.surf2})`,
      border:`1px solid ${card.accent}30`,
      boxShadow:`${T.elevation.lg},0 0 60px ${card.accent}08`,
      transition:"border-color .5s,box-shadow .5s"}}>
      <div style={{height:"2px",background:`linear-gradient(90deg,${card.accent},${card.accent}00)`}}/>
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:"6px",flex:1,flexWrap:"wrap"}}>
          <Lbl>Intelligence</Lbl>
          <Badge color={phaseCol}>{sig.phase}</Badge>
          <Badge color={sig.pressureColor}>{sig.pressureLabel}</Badge>
          <Badge color={sig.momColor}>{sig.momLabel}</Badge>
        </div>
        <div style={{display:"flex",gap:"3px",alignItems:"center"}}>
          <button onClick={()=>setAuto(p=>!p)} className="pressBtn" style={{
            padding:"3px 8px",borderRadius:D.pill,cursor:"pointer",fontFamily:D.head,fontSize:"9px",
            border:`1px solid ${auto?D.emerald+"44":D.border}`,background:"transparent",
            color:auto?D.emerald:D.textMuted,transition:"all .2s",
          }} aria-label={auto?"Pause the cards":"Play the cards"}><Icon name={auto?"pause":"play"}/></button>
        </div>
      </div>
      <div style={{padding:"16px 18px",position:"relative"}}>
        <div style={{position:"absolute",top:-10,right:-10,width:"90px",height:"90px",borderRadius:"50%",
          background:`${card.accent}14`,filter:"blur(28px)",pointerEvents:"none"}}/>
        <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:card.accent,marginBottom:"13px",lineHeight:1.3,position:"relative"}}>{card.hl}</div>
        <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"16px"}}>
          {card.chips.map((chip,i)=>(
            <div key={i} style={{background:D.surf0,border:`1px solid ${chip.c?`${chip.c}28`:D.border}`,
              borderRadius:D.md,padding:"9px 14px",display:"flex",flexDirection:"column",alignItems:"center",minWidth:"58px",gap:"3px"}}>
              <span style={{fontFamily:D.mono,fontSize:"19px",fontWeight:500,color:chip.c||D.textPrimary,lineHeight:1,letterSpacing:"-0.01em"}}>{chip.v}</span>
              <span style={{fontFamily:D.head,fontSize:"8.5px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted}}>{chip.l}</span>
            </div>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"10px",borderTop:`1px solid ${D.border}`,paddingTop:"13px"}}>
          <SignalBar label="Pressure" value={`${sig.pressure}%`} pct={sig.pressure} color={sig.pressureColor}/>
          <SignalBar label="Momentum" value={sig.momLabel} pct={50+sig.mom/2} color={sig.momColor} center/>
          <SignalBar label={sig.reqRr?"Req RR":"Run Rate"} value={sig.reqRr??sig.rr} pct={Math.min(100,(sig.reqRr||sig.rr)/18*100)} color={sig.reqRr&&sig.rrDelta<-1?D.rose:D.sky}/>
        </div>
      </div>
      <div style={{padding:"8px 16px",borderTop:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"8px",background:`${D.surf0}55`}}>
        <div style={{display:"flex",gap:"4px",flex:1,flexWrap:"wrap"}}>
          {cards.map((c,i)=>(
            <button key={i} onClick={()=>{setIdx(i);setAuto(false);}} style={{
              width:i===idx?"18px":"6px",height:"6px",borderRadius:"4px",border:"none",cursor:"pointer",padding:0,
              background:i===idx?card.accent:`${D.textMuted}30`,transition:"all .3s ease",
            }}/>
          ))}
        </div>
        <span style={{color:D.textMuted,fontSize:"9px",fontFamily:D.mono,flexShrink:0}}>{idx+1}/{cards.length}</span>
        {sig.flags.slice(0,2).map(f=>(
          <Badge key={f} color={D.orange} sx={{fontSize:"7.5px",padding:"2px 6px"}}>{f.replace(/_/g," ")}</Badge>
        ))}
      </div>
    </div>
  );
}

function ScorecardPanel({innings,idx}){
  const i=innings[idx];if(!i)return null;
  const batted=i.batsmen.filter(b=>b.balls>0||b.status==="batting"||b.status==="dnb");
  const bowled=i.bowlers.filter(b=>b.balls>0);
  const xtra=i.extras.wide+i.extras.noBall+i.extras.bye+i.extras.legBye+i.extras.penalty;
  const thRow=(cols,colDefs)=>(
    <div style={{padding:"9px 14px 6px",display:"grid",gridTemplateColumns:colDefs,gap:"4px",borderBottom:`1px solid ${D.border}`}}>
      {cols.map(h=><Lbl key={h} sx={{textAlign:h===cols[0]?"left":"right"}}>{h}</Lbl>)}
    </div>
  );
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
      <div style={{background:`linear-gradient(135deg,${D.surf1},${D.surf2})`,borderRadius:D.lg,padding:"16px 18px",border:`1px solid ${D.border}`}}>
        <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textMuted,marginBottom:"3px"}}>{i.battingTeam} · {isSuperOver(i)?`${superOverTitle(i.superOver)}, ${pairPlace(innings,idx)} innings`:`Innings ${idx+1}`}</div>
        <div style={{fontFamily:D.mono,fontSize:"38px",fontWeight:500,color:D.textPrimary,lineHeight:1,letterSpacing:"-0.02em"}}>
          {i.runs}<span style={{color:D.textMuted,fontSize:"26px",fontWeight:400}}>/{i.wickets}</span>
        </div>
        <div style={{color:D.textMuted,fontSize:"12px",fontFamily:D.body,marginTop:"4px"}}>{fmtOv(i.balls)} overs · RR {RR(i.runs,i.balls)}</div>
      </div>
      {/* Batting */}
      <Card>
        {thRow(["Batsman","R","B","4s","6s","SR"],"1fr 30px 30px 26px 26px 42px")}
        {batted.map((b,ii)=>(
          <div key={b.id} style={{padding:"8px 14px",display:"grid",gridTemplateColumns:"1fr 30px 30px 26px 26px 42px",gap:"4px",
            background:ii%2?`${D.surf2}60`:"transparent",borderBottom:`1px solid ${D.border}`,alignItems:"start"}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
                {b.status==="batting"&&<div className="liveDot" style={{width:"5px",height:"5px",borderRadius:"50%",background:D.emerald,flexShrink:0}}/>}
                <span style={{color:D.textPrimary,fontSize:"13px",fontFamily:D.body,fontWeight:500}}>{b.name}</span>
                {b.status==="dnb"&&<span style={{color:D.textMuted,fontSize:"12px",fontFamily:D.body}}>(dnb)</span>}
              </div>
              {b.dismissal&&<div style={{color:D.textMuted,fontSize:"12px",marginTop:"2px",fontFamily:D.body,fontStyle:"italic"}}>{b.dismissal}</div>}
            </div>
            {[b.runs,b.balls,b.fours,b.sixes,SR(b.runs,b.balls)].map((v,j)=>(
              <div key={j} style={{textAlign:"right",fontFamily:D.mono,fontSize:"12px",fontWeight:j===0?"500":"400",
                color:j===2?textOn(D.indigo):j===3?D.amber:j===4?D.textMuted:D.textPrimary}}>{v}</div>
            ))}
          </div>
        ))}
        <div style={{padding:"7px 14px",display:"flex",justifyContent:"space-between"}}>
          <span style={{color:D.textMuted,fontSize:"12px",fontFamily:D.body}}>
            Extras: Wd {i.extras.wide} · NB {i.extras.noBall} · B {i.extras.bye} · LB {i.extras.legBye}{i.extras.penalty>0?` · Pen ${i.extras.penalty}`:""}
          </span>
          <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textSecondary}}>{xtra}</span>
        </div>
      </Card>
      {/* Fall of Wickets */}
      {i.fow.length>0&&(
        <Card style={{padding:"12px 14px"}}>
          <Lbl sx={{marginBottom:"8px"}}>Fall of Wickets</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
            {i.fow.map((f,ii)=>(
              <div key={ii} style={{background:`${D.rose}10`,border:`1px solid ${D.rose}28`,borderRadius:D.sm,padding:"4px 10px"}}>
                <span style={{color:D.roseText,fontFamily:D.mono,fontSize:"12px",fontWeight:500}}>{f.runs}/{f.wickets}</span>
                <span style={{color:D.textMuted,fontSize:"12px",fontFamily:D.body,marginLeft:"5px"}}>{f.batsman} ({f.overs})</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      {/* Bowling */}
      <Card>
        {thRow(["Bowler","O","M","R","W","Econ"],"1fr 38px 24px 32px 26px 42px")}
        {bowled.map((b,ii)=>(
          <div key={b.id} data-testid={`card-bowler-${b.id}`} style={{padding:"8px 14px",display:"grid",gridTemplateColumns:"1fr 38px 24px 32px 26px 42px",gap:"4px",
            background:ii%2?`${D.surf2}60`:"transparent",borderBottom:`1px solid ${D.border}`,alignItems:"center"}}>
            <span style={{color:D.textPrimary,fontSize:"13px",fontFamily:D.body,fontWeight:500}}>{b.name}</span>
            {[fmtOv(b.balls),b.maidens,b.runs,b.wickets,RR(b.runs,b.balls)].map((v,j)=>(
              <div key={j} style={{textAlign:"right",fontFamily:D.mono,fontSize:"12px",
                fontWeight:j===3?"500":"400",color:j===3?D.rose:D.textPrimary}}>{v}</div>
            ))}
          </div>
        ))}
        {/* A bowler replaced during an over, and why (SCRBRD-080). A log from
            before the pad asked has no reason, and says so. */}
        {(i.bowlerChanges||[]).length>0&&(
          <div data-testid="bowler-changes" style={{padding:"7px 14px",display:"flex",flexDirection:"column",gap:"3px"}}>
            {i.bowlerChanges.map((c,ci)=>{
              const nm=id=>i.bowlers.find(b=>b.id===id)?.name??id??"?";
              return (
                <span key={ci} style={{color:D.textMuted,fontSize:"12px",fontFamily:D.body}}>
                  Over {c.over+1}.{c.ballInOver}: {nm(c.to)} took over from {nm(c.from)}{c.reason?` (${c.reason==="suspended"?"suspended":"injured"})`:" (reason not recorded)"}
                </span>
              );
            })}
          </div>
        )}
        {/* A bowler the umpires suspended (SCRBRD-094 item 2): why, and for
            how long, in words — no Law clause numbers. */}
        {(i.suspensions||[]).length>0&&(
          <div data-testid="bowler-suspensions" style={{padding:"7px 14px",display:"flex",flexDirection:"column",gap:"3px"}}>
            {i.suspensions.map((s,si)=>(
              <span key={si} style={{color:D.textSecondary,fontSize:"12px",fontFamily:D.body}}>
                {i.bowlers.find(b=>b.id===s.bowler)?.name??s.bowler} {suspensionWords(s).replace(/^Suspended/,"suspended")}
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// Detect milestones on a ball
// `inn` is the PRE-ball snapshot (updInn's updater is deferred by React),
// so post-ball values must be derived from the committed ball itself.
function detectMilestone(ball,inn){
  const bat=inn?.batsmen.find(b=>b.id===ball.striker);
  const bow=inn?.bowlers.find(b=>b.id===ball.bowler);
  const milestones=[];
  if(bat&&ball.type!=="W"&&ball.type!=="Wd"&&ball.type!=="Nb"){
    const credit=ball.type==="run"?(ball.value||0):0; // byes/leg-byes don't credit the batter
    const prev=bat.runs, cur=bat.runs+credit;
    if(prev<50&&cur>=50)milestones.push({type:"fifty",label:"FIFTY!",sub:bat.name+" reaches 50",color:D.sky,icon:"bat"});
    if(prev<100&&cur>=100)milestones.push({type:"century",label:"CENTURY!",sub:bat.name+" — 100 not out",color:D.amber,icon:"medal"});
    if(prev<150&&cur>=150)milestones.push({type:"150",label:"150!",sub:bat.name+" on 150",color:D.amber,icon:"flame"});
    if(prev<200&&cur>=200)milestones.push({type:"200",label:"DOUBLE!",sub:bat.name+" — 200 runs!",color:D.amber,icon:"crown"});
  }
  if(bow&&ball.type==="W"){
    const wkts=(bow.wickets||0)+1; // including this dismissal
    if(wkts===5)milestones.push({type:"fifer",label:"FIFER!",sub:bow.name+" takes 5 wickets",color:D.roseText,icon:"ball"});
    if(wkts>=3){
      const legal=(inn?.ballLog||[]).filter(b=>b.type!=="Wd"&&b.type!=="Nb").slice(-2);
      if(legal.length===2&&legal.every(b=>b.type==="W"&&b.bowler===bow.id))
        milestones.push({type:"hattrick",label:"HAT-TRICK!",sub:bow.name+" — 3 in a row!",color:D.roseText,icon:"sparkles"});
    }
    if((inn?.wickets||0)+1>=10)milestones.push({type:"allout",label:"ALL OUT!",sub:(inn?.battingTeam||"")+" all out",color:D.roseText,icon:"bails-off"});
    // Tier 3 (DESIGN_DIRECTION §10): the HAT-TRICK BALL joins the interrupt —
    // this overlay queue is the one the pad already has. Two of the bowler's
    // wickets off his last two legal balls, not three (that is the hat-trick
    // itself), with the innings still going. Only a wicket that is the
    // bowler's counts: a run out on the second ball puts no one on a hat-trick.
    // A caller that does not say how the batter was out is not trusted with it.
    else{
      const mine=(b)=>b?.type==="W"&&!b.freeHitSaved&&b.bowler===bow.id&&chargedToBowler(normaliseDismissal(b.dismissal));
      const legal=(inn?.ballLog||[]).filter(b=>b.type!=="Wd"&&b.type!=="Nb").slice(-2);
      if(ball.dismissal!=null&&chargedToBowler(normaliseDismissal(ball.dismissal))&&mine(legal.at(-1))&&!mine(legal.at(-2)))
        milestones.push({type:"hattrickball",label:"HAT-TRICK BALL",sub:bow.name+" — two in two",color:D.roseText,icon:"sparkles"});
    }
  }
  // Team milestones — total includes extras
  if(inn){
    const added=(ball.type==="Wd"||ball.type==="Nb")?1+(ball.value||0):(ball.value||0);
    const prevRuns=inn.runs, postRuns=inn.runs+added;
    [50,100,150,200,250,300,350,400].forEach(n=>{
      if(prevRuns<n&&postRuns>=n)milestones.push({type:"team"+n,label:n+"!",sub:inn.battingTeam+" reach "+n,color:D.indigoText,icon:"bat"});
    });
  }
  return milestones.length>0?milestones[0]:null;
}

/* ═══════════════════════════════════════════════════════
   COMMENTARY CARD  (top-level, used inside Score tab)
═══════════════════════════════════════════════════════ */
// The base lines are the shared generator's (@scrbrd/scoring/commentary,
// SCRBRD-098): the words the Match Centre's Commentary tab shows, from the
// same log, so the scorer and the ground read the same thing. The scorer is
// the one reader who is told health and discipline (`sensitive`): who retired
// hurt, why a bowler came off. The optional AI line for the latest ball is as
// it was: asked for once, shown over the base line when it comes back, and
// never shown anywhere but here.
function CommentaryCard({inn,innings,events}){
  const items=useMemo(()=>{
    const logs=events??[];
    if(!logs.some(l=>l?.length))return[];
    const nameOf=nameBook(innings??[inn]);
    // Folded under the rules the pad's own fold was (the Edition, the free
    // hit: SCRBRD-113), so the words and the scorecard agree.
    // A super over's lines are worded by lib/superOver.js (SCRBRD-114 phase 3b).
    return superOverCommentary(deriveCommentary(logs,{nameOf:(ref)=>nameOf(ref),sensitive:true,ctx:rulesOf(innings)}),innings??[]);
  // The fold is derived from `events`; the names come with it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[events]);
  const log=[...items].reverse().slice(0,8);
  const entryOf=(item)=>(inn?.ballLog||[]).find(b=>b.id!=null&&(item.key===`e:${b.id}`));
  const[aiLines,setAiLines]=useState({});
  const[loading,setLoading]=useState(false);
  // Generate AI commentary for the latest ball when ballLog changes
  const lastBallKey=inn?.ballLog?.length?
    (inn.ballLog[inn.ballLog.length-1].over+"_"+inn.ballLog[inn.ballLog.length-1].ballInOver):null;
  useEffect(()=>{
    if(!lastBallKey||!inn||aiLines[lastBallKey])return;
    setLoading(true);
    const latestBall=inn.ballLog[inn.ballLog.length-1];
    const mile=detectMilestone(latestBall,inn);
    fetchAICommentary(latestBall,inn,mile?mile.label:null).then(line=>{
      if(line)setAiLines(prev=>({...prev,[lastBallKey]:line}));
      setLoading(false);
    });
  },[lastBallKey]);
  const getBallKey=(b)=>b.over+"_"+b.ballInOver;
  const lastBall=inn?.ballLog?.[inn.ballLog.length-1];
  return (
    <Card style={{overflow:"hidden"}}>
      <div style={{padding:"10px 14px 9px",borderBottom:"1px solid "+D.border,
        display:"flex",alignItems:"center",gap:"8px"}}>
        <Lbl>Commentary</Lbl>
        {loading&&<div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,fontStyle:"italic"}}>AI writing…</div>}
        <div className="liveDot" style={{width:"5px",height:"5px",borderRadius:"50%",
          background:D.emerald,marginLeft:"auto",flexShrink:0}}/>
      </div>
      {log.length===0&&(
        <div style={{padding:"16px 14px",color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>
          No balls bowled yet.
        </div>
      )}
      {log.map((item,i)=>{
        const b=entryOf(item);
        const shot=b?.shot?ALL_SHOTS_FLAT.find(s=>s.id===b.shot):null;
        // Where it went, for the batter who faced it (SCRBRD-101).
        const where=b?areaWords(b,batHandOf(inn,b.strikerId)):null;
        const first=i===0;
        const isWkt=item.kind==="wicket";
        const isSix=item.kind==="six";
        const isFour=item.kind==="four";
        const accentCol=isWkt?D.rose:isSix?D.amber:isFour?D.sky:null;
        const aiLine=b?aiLines[getBallKey(b)]:null;
        // Left accent stripe colour
        const stripeCol=isWkt?D.rose:isSix?D.amber:isFour?D.sky:first?D.indigo+"55":"transparent";
        return (
          <div key={item.key} data-testid="pad-commentary-line" data-kind={item.kind} style={{
            display:"flex",alignItems:"flex-start",gap:"0",
            background:first?(isWkt?D.rose+"07":isSix?D.amber+"07":isFour?D.sky+"06":D.indigo+"07"):"transparent",
            borderBottom:i<log.length-1?"1px solid "+D.border:"none",
            opacity:Math.max(0.25,1-i*0.1),
            borderLeft:"3px solid "+stripeCol,
          }}>
            <div style={{padding:"9px 10px 9px 12px",flexShrink:0,width:"22px"}}>
              {b&&<BallDot ball={b} size={22}/>}
            </div>
            <div style={{flex:1,minWidth:0,padding:"9px 12px 9px 0"}}>
              {/* Over + ball indicator */}
              {b&&<div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"3px"}}>
                <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textMuted,flexShrink:0}}>
                  {item.over}.{item.ball}
                </span>
                {b.bowlerApproach&&<Badge color={D.amber} sx={{fontSize:"12px",padding:"1px 5px"}}>{b.bowlerApproach==="Around the wicket"?"Around":"Over"}</Badge>}
                {isWkt&&<Badge color={D.rose} sx={{fontSize:"12px",padding:"1px 5px"}}>WICKET</Badge>}
                {isSix&&<Badge color={D.amber} sx={{fontSize:"12px",padding:"1px 5px"}}>SIX</Badge>}
                {isFour&&<Badge color={D.sky} sx={{fontSize:"12px",padding:"1px 5px"}}>FOUR</Badge>}
              </div>}
              {/* AI commentary line */}
              {aiLine&&(
                <div style={{fontFamily:D.body,fontSize:first?"13px":"12px",fontWeight:first?500:400,
                  color:accentCol||D.textPrimary,marginBottom:"4px",lineHeight:1.45}}>
                  {aiLine}
                </div>
              )}
              {/* The shared generator's line */}
              {!aiLine&&(
                <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:first?600:400,lineHeight:1.45,
                  color:accentCol||D.textPrimary}}>
                  {first&&loading&&b===lastBall?"Generating commentary…":item.text}
                </div>
              )}
              {/* Metadata tags */}
              {b&&<div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginTop:"2px",
                display:"flex",gap:"7px",flexWrap:"wrap",alignItems:"center"}}>
                {shot&&<span style={{color:shot.color}}>{shot.label}</span>}
                {where&&<span><Icon name="map-pin"/>{" "+where}</span>}
                {b.bowlerApproach&&<span style={{color:D.amber}}><Icon name="corner-right-down"/>{" "+b.bowlerApproach}</span>}
              </div>}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════
   UTIL
═══════════════════════════════════════════════════════ */
// Build event config from ball value or milestone object
function buildEventCfg(ballValue,milestone){
  if(milestone)return{
    label:milestone.label,sub:milestone.sub,
    color:milestone.color,bg:milestone.color+"08",
    icon:milestone.icon,isMilestone:true,
  };
  if(ballValue===4)return{label:"FOUR!",sub:"Boundary",color:D.sky,glow:clr(D.sky,.5),bg:clr(D.sky,.06)};
  if(ballValue===6)return{label:"SIX!",sub:"Maximum!",color:D.amber,glow:clr(D.amber,.6),bg:clr(D.amber,.06)};
  if(ballValue==="W")return{label:"WICKET!",sub:"Out",color:D.roseText,glow:clr(D.rose,.5),bg:clr(D.rose,.06)};
  return null;
}

/* ═══════════════════════════════════════════════════════
   INNINGS OVER BANNER — SCRBRD-038

   The review sheet is a checkpoint, not a trap: Escape closes it, and it has
   to, because a modal a scorer cannot dismiss is a modal a scorer learns to
   dread. This is what makes that safe — the innings is over whether or not
   anyone has confirmed it, so the state says so persistently and offers the
   way forward.

   It is derived from `complete` rather than raised by the transition, which
   also closes a hole that predates the review. A delivery is not the only
   thing that can end an innings: penalty runs can complete a chase, and an
   umpires' revision that cuts the overs below the balls already bowled ends it
   with no ball bowled at all. Neither of those paths ever transitioned, so an
   innings ended that way simply sat there. Reading the state catches all three
   without the engine having to remember which acts can finish a match.
═══════════════════════════════════════════════════════ */
function InningsOverBanner({onReview}){
  return (
    <div style={{
      position:"fixed",top:"72px",left:"50%",transform:"translateX(-50%)",
      zIndex:1000,padding:"10px 20px",borderRadius:D.pill,
      background:D.surf3,border:`1px solid ${D.amber}66`,
      boxShadow:T.elevation.lg,
      display:"flex",alignItems:"center",gap:"14px",
      animation:"bounceIn .4s cubic-bezier(.22,1,.36,1)",
    }} data-testid="innings-over-banner">
      <div>
        <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:800,color:D.textPrimary,letterSpacing:"0.04em"}}>INNINGS OVER</div>
        <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>Not closed yet — check the figures first</div>
      </div>
      <button onClick={onReview} className="pressBtn" data-testid="banner-review"
        style={{minHeight:"44px",padding:"7px 16px",borderRadius:D.pill,cursor:"pointer",border:"none",
          background:D.amber,color:inkOn(D.amber),
          fontFamily:D.body,fontSize:"15px",fontWeight:700}}>
        Review
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   FREE HIT BANNER — shown when next ball is a free hit
═══════════════════════════════════════════════════════ */
function FreeHitBanner({onDismiss}){
  return (
    <div style={{
      position:"fixed",top:"72px",left:"50%",transform:"translateX(-50%)",
      zIndex:1000,padding:"10px 24px",borderRadius:D.pill,
      background:T.light.alert,
      boxShadow:`0 0 0 4px ${clr(D.orange,.3)}`,
      animation:"freeHitPulse 1s ease infinite, bounceIn .4s cubic-bezier(.22,1,.36,1)",
      display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",
    }} onClick={onDismiss}>
      <span style={{fontSize:"20px",color:T.light.ink}}><Icon name="zap"/></span>
      <div>
        <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:800,color:T.light.ink,letterSpacing:"0.1em"}}>FREE HIT!</div>
        <div style={{fontFamily:D.body,fontSize:"12px",color:T.light.ink}}>Next ball: batter can only be run out</div>
      </div>
      <span style={{fontSize:"20px",color:T.light.ink}}><Icon name="zap"/></span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   PARTNERSHIP CARD
═══════════════════════════════════════════════════════ */
function PartnershipCard({inn}){
  if(!inn)return null;
  const cur=inn.curPartner;
  const hist=inn.partnerships||[];
  const bat1=inn.batsmen.find(b=>b.id===inn.striker);
  const bat2=inn.batsmen.find(b=>b.id===inn.nonStriker);
  const maxRuns=Math.max(1,...hist.map(p=>p.runs),(cur?.runs||0));
  return (
    <Card style={{overflow:"hidden"}}>
      <div style={{padding:"10px 14px 9px",borderBottom:"1px solid "+D.border}}>
        <Lbl>Partnerships</Lbl>
      </div>
      {/* Current partnership */}
      {bat1&&bat2&&(
        <div style={{padding:"12px 14px",background:D.indigo+"08",borderBottom:"1px solid "+D.border}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
              <div className="liveDot" style={{width:"6px",height:"6px",borderRadius:"50%",background:D.emerald}}/>
              <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>
                {bat1.name} & {bat2.name}
              </span>
            </div>
            <div style={{display:"flex",gap:"14px",alignItems:"baseline"}}>
              <div style={{textAlign:"right"}}>
                <div style={{fontFamily:D.mono,fontSize:"22px",fontWeight:500,color:D.textPrimary,lineHeight:1}}>{cur?.runs||0}</div>
                <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,textAlign:"center"}}>{cur?.balls||0}b</div>
              </div>
              {(cur?.balls||0)>0&&(
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:D.mono,fontSize:"12px",color:D.textSecondary}}>{RR(cur.runs,cur.balls)}</div>
                  <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>RR</div>
                </div>
              )}
            </div>
          </div>
          {/* Partnership bar */}
          <div style={{height:"4px",background:D.surf3,borderRadius:"4px",overflow:"hidden"}}>
            <div style={{height:"100%",borderRadius:"4px",
              background:"linear-gradient(90deg,"+D.indigo+","+D.sky+")",
              width:Math.min(100,((cur?.runs||0)/maxRuns)*100)+"%",
              transition:"width .4s ease"}}/>
          </div>
        </div>
      )}
      {/* Partnership history */}
      {hist.length>0&&(
        <div style={{padding:"8px 14px"}}>
          <Lbl sx={{marginBottom:"7px",color:D.textMuted}}>Batting Partnerships</Lbl>
          {hist.map((p,i)=>(
            <div key={i} style={{marginBottom:"8px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"3px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                  <span style={{fontFamily:D.mono,fontSize:"12px",color:D.roseText,fontWeight:600}}>{p.wicket-1}/{p.wicket}</span>
                  <span style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>{p.bat1} & {p.bat2}</span>
                </div>
                <div style={{display:"flex",gap:"10px",alignItems:"baseline"}}>
                  <span style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:D.textPrimary}}>{p.runs}</span>
                  <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textMuted}}>{p.balls}b</span>
                  <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textSecondary}}>{RR(p.runs,p.balls)}</span>
                </div>
              </div>
              <div style={{height:"3px",background:D.surf3,borderRadius:"3px",overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:"3px",
                  background:"linear-gradient(90deg,"+D.violet+"99,"+D.indigo+"66)",
                  width:Math.min(100,(p.runs/maxRuns)*100)+"%"}}/>
              </div>
            </div>
          ))}
        </div>
      )}
      {!bat1&&!bat2&&hist.length===0&&(
        <div style={{padding:"16px 14px",color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>
          No partnerships recorded yet.
        </div>
      )}
    </Card>
  );
}

export { CommentaryCard, FreeHitBanner, InningsOverBanner, IntelPanel, PartnershipCard, ScorecardPanel, WagonWheel, buildEventCfg, detectMilestone };
