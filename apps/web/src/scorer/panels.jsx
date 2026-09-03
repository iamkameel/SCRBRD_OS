import { useState, useEffect, useRef } from "react";
import { placementFromTap, screenAngle } from "@scrbrd/scoring";
import { D, px } from "../design/tokens.js";
import { can } from "../rbac/index.js";
import { CX, CY, LK_COLS, R_BND, R_IN, R_MID, R_PITCH, SEGS, ballAngle, heatColor, lineKey, pieSlice, ringArc, toXY, wagEnd } from "./field.js";
import { RR, fmtOv, SR } from "./format.js";
import { buildNarratives, buildSignals } from "./signals.js";
import { ALL_SHOTS_FLAT } from "./shots.js";
import { Badge, BallDot, Card, Lbl, SignalBar } from "./ui.jsx";

/* ═══════════════════════════════════════════════════════
   DYNAMIC CONTENT BAR (DCB) — persistent smart strip
═══════════════════════════════════════════════════════ */
function DynamicBar({inn,match,target,isChase,lastOver}){
  const[cardIdx,setCardIdx]=useState(0);
  const[prevCard,setPrevCard]=useState(null);
  const[animKey,setAnimKey]=useState(0);
  const timerRef=useRef(null);
  const sig=buildSignals(inn,match?.overs||20,target,isChase);
  const cards=buildNarratives(sig,lastOver);

  useEffect(()=>{
    if(cards.length===0)return;
    clearInterval(timerRef.current);
    timerRef.current=setInterval(()=>{
      setCardIdx(p=>{const next=(p+1)%cards.length;return next;});
      setAnimKey(k=>k+1);
    },7000);
    return()=>clearInterval(timerRef.current);
  },[cards.length,sig?.balls]);

  // Snap to top card when a new high-priority event arrives.
  // Compare by content key — cards are rebuilt fresh every render, so
  // identity comparison re-fires setPrevCard each render (infinite loop
  // whenever the innings has any balls, e.g. a resumed live match).
  const topCard=cards[0];
  const topKey=topCard?`${topCard.type}|${topCard.hl}`:null;
  useEffect(()=>{
    if(topKey&&topKey!==prevCard){
      if(topCard.pri>=70){setCardIdx(0);setAnimKey(k=>k+1);}
      setPrevCard(topKey);
    }
  },[topKey]);

  if(!sig||!inn)return null;
  const card=cards[Math.min(cardIdx,cards.length-1)]||cards[0];
  if(!card)return null;

  // RR section — always visible on left
  const rrCol=isChase?(sig.rrDelta!=null&&sig.rrDelta<-1?D.rose:D.emerald):D.sky;
  const rrrDelta=sig.rrDelta!=null?sig.rrDelta:null;
  const phaseCol=sig.phase==="POWERPLAY"?D.emerald:sig.phase==="MIDDLE"?D.amber:D.orange;

  return (
    <div style={{
      position:"sticky",top:"45px",zIndex:95,
      background:`linear-gradient(180deg,${D.base}f8 0%,${D.base}e0 100%)`,
      backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",
      borderBottom:`1px solid ${D.border}`,
    }}>
      <div style={{maxWidth:"1320px",margin:"0 auto",
        display:"grid",gridTemplateColumns:"auto 1fr auto",
        alignItems:"stretch",gap:0,minHeight:"52px"}}>

        {/* LEFT — RR always visible */}
        <div style={{
          display:"flex",alignItems:"center",gap:0,
          borderRight:`1px solid ${D.border}`,
          padding:"0 16px",flexShrink:0,
        }}>
          {/* CRR */}
          <div style={{textAlign:"center",padding:"0 10px",borderRight:`1px solid ${D.border}66`}}>
            <div style={{fontFamily:D.mono,fontSize:"21px",fontWeight:500,color:rrCol,lineHeight:1,letterSpacing:"-0.02em"}}>{sig.rr}</div>
            <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginTop:"2px"}}>CRR</div>
          </div>
          {/* RRR if chasing */}
          {isChase&&sig.reqRr!=null&&(
            <div style={{textAlign:"center",padding:"0 10px",borderRight:`1px solid ${D.border}66`}}>
              <div style={{fontFamily:D.mono,fontSize:"21px",fontWeight:500,color:sig.rrDelta<-1?D.rose:sig.rrDelta>0.5?D.emerald:D.amber,lineHeight:1,letterSpacing:"-0.02em"}}>{sig.reqRr}</div>
              <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginTop:"2px"}}>RRR</div>
            </div>
          )}
          {/* Phase badge */}
          <div style={{padding:"0 10px",display:"flex",flexDirection:"column",alignItems:"center",gap:"3px"}}>
            <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:phaseCol,letterSpacing:"0.08em",textTransform:"uppercase",
              padding:"2px 8px",borderRadius:D.pill,border:`1px solid ${phaseCol}33`,background:phaseCol+"10"}}>{sig.phase}</div>
            <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{fmtOv(sig.balls)} ov</div>
          </div>
        </div>

        {/* CENTRE — rotating narrative card */}
        <div key={animKey} style={{
          display:"flex",alignItems:"center",gap:"12px",
          padding:"8px 16px",overflow:"hidden",
          animation:"fadeIn .4s ease both",
        }}>
          {card.icon&&<span style={{fontSize:"16px",flexShrink:0}}>{card.icon}</span>}
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:card.accent,
              whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",lineHeight:1.2}}>{card.hl}</div>
            <div style={{display:"flex",gap:"8px",marginTop:"5px",flexWrap:"nowrap",overflow:"hidden"}}>
              {card.chips.slice(0,3).map((chip,i)=>(
                <div key={i} style={{display:"flex",alignItems:"baseline",gap:"3px",flexShrink:0}}>
                  <span style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:chip.c||D.textPrimary,lineHeight:1}}>{chip.v}</span>
                  <span style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:D.textMuted}}>{chip.l}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — pressure + momentum micro-bars + dot nav */}
        <div style={{
          display:"flex",alignItems:"center",gap:"8px",
          borderLeft:`1px solid ${D.border}`,padding:"0 12px",flexShrink:0,
        }}>
          {/* Momentum indicator */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",width:"38px"}}>
            <div style={{width:"100%",height:"4px",background:D.surf3,borderRadius:"4px",overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:"4px",
                width:Math.min(100,Math.max(0,50+sig.mom/2))+"%",
                background:sig.momColor,transition:"width .5s ease"}}/>
            </div>
            <span style={{fontFamily:D.head,fontSize:"7.5px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:sig.momColor}}>{sig.momLabel}</span>
          </div>
          {/* Pressure indicator */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",width:"38px"}}>
            <div style={{width:"100%",height:"4px",background:D.surf3,borderRadius:"4px",overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:"4px",
                width:sig.pressure+"%",
                background:sig.pressureColor,transition:"width .5s ease"}}/>
            </div>
            <span style={{fontFamily:D.head,fontSize:"7.5px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:sig.pressureColor}}>{sig.pressureLabel}</span>
          </div>
          {/* Card nav dots.
              These were 5x5 buttons with no text, which is two failures at
              once: nothing to announce, and a target a third the size anyone
              can reliably hit — on a phone, one-handed, at a cricket ground.
              The dot stays 5px because that is the design; the BUTTON around
              it is padded out to a real target, which costs no layout because
              the padding is transparent. */}
          {cards.length>1&&(
            <div role="tablist" aria-label="Match insight cards" style={{display:"flex",flexDirection:"column",gap:"3px",margin:"-6px"}}>
              {cards.slice(0,5).map((c,i)=>(
                <button key={i} onClick={()=>{setCardIdx(i);setAnimKey(k=>k+1);}}
                  role="tab" aria-selected={i===cardIdx}
                  aria-label={c?.hl ? `${c.hl}` : `Card ${i+1} of ${Math.min(cards.length,5)}`}
                  style={{border:"none",padding:"6px",background:"transparent",cursor:"pointer",
                    display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <span aria-hidden="true" style={{display:"block",width:i===cardIdx?"14px":"5px",height:"5px",borderRadius:"4px",
                    background:i===cardIdx?(cards[i]?.accent||D.indigo):`${D.textMuted}55`,transition:"all .25s"}}/>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Accent line — colour from top card */}
      <div style={{height:"1.5px",background:`linear-gradient(90deg,${card.accent},${card.accent}55,transparent)`,transition:"background .5s"}}/>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   WAGON WHEEL
═══════════════════════════════════════════════════════ */
/**
 * @param batHand handedness of the batter these balls belong to. Point-era
 *   placements are stored batter-relative, so the mirror happens at RENDER
 *   time — one wheel can therefore show a left-hander's innings correctly
 *   without any of the stored balls being rewritten.
 */
function WagonWheel({ballLog=[],selSeg,onSel,onPlace,viewMode,onViewMode,hidden,onToggle,batHand="R"}){
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
    const r=svg.getBoundingClientRect();
    const t=e.touches?.[0]??e.changedTouches?.[0]??e;
    // Client pixels → the SVG's own 300x300 user space.
    const x=((t.clientX-r.left)/r.width)*300-CX;
    const y=((t.clientY-r.top)/r.height)*300-CY;
    // Inverse of toXY: x = r·sin(a), y = -r·cos(a).
    const angle=(Math.atan2(x,-y)*180/Math.PI+360)%360;
    const radius=Math.min(Math.hypot(x,y)/R_BND,1);
    return placementFromTap({angle,radius,batHand});
  };
  const[hov,setHov]=useState(null);
  const segRuns=Array(12).fill(0);
  ballLog.forEach(b=>{if(b.seg!=null)segRuns[b.seg]+=(b.value||0);});
  const maxR=Math.max(...segRuns,1);
  const isSel=id=>selSeg?.seg===id;
  const zoneFill=(id,zone)=>{
    const sel=isSel(id),hv=hov?.seg===id;
    if(viewMode==="heatmap")return heatColor(segRuns[id],maxR)||"transparent";
    if(sel&&selSeg.zone===zone)return"rgba(79,70,229,.38)";
    if(sel)return"rgba(79,70,229,.14)";
    if(hv)return"rgba(14,165,233,.12)";
    return"transparent";
  };
  // A ball with neither a captured point nor a sector has no position at all
  // — a leave, a ball that hit the pad — and belongs on no wheel.
  const visLines=ballLog.filter(b=>(b.seg!=null||b.theta!=null)&&!hidden.has(lineKey(b)));
  // How many of these were captured as points rather than sectors. Shown
  // rather than hidden: a wheel mixing eras should say so.
  const pointCount=visLines.filter(b=>b.placementSource==="point").length;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"11px"}}>
      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
        <Lbl>Field Map</Lbl>
        <div style={{marginLeft:"auto",display:"flex",gap:"2px",background:D.surf3,borderRadius:D.pill,padding:"3px"}}>
          {["wagon","heatmap"].map(m=>(
            <button key={m} onClick={()=>onViewMode(m)} className="pressBtn" style={{
              padding:"4px 13px",borderRadius:D.pill,border:"none",cursor:"pointer",
              background:viewMode===m?D.grad:"transparent",
              color:viewMode===m?"#fff":D.textMuted,
              fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.06em",
              textTransform:"uppercase",transition:"all .25s",
            }}>{m==="wagon"?"Wheel":"Heat"}</button>
          ))}
        </div>
      </div>
      <div style={{width:"100%",maxWidth:"272px",margin:"0 auto",aspectRatio:"1",userSelect:"none"}}>
        <svg ref={svgRef} viewBox="0 0 300 300" style={{width:"100%",height:"100%",display:"block"}}
          role={onPlace?"application":"img"}
          aria-label={onPlace
            ?"Field. Tap where the ball went."
            :`Wagon wheel, ${visLines.length} balls${pointCount?`, ${pointCount} placed exactly`:""}`}>
          <defs>
            <radialGradient id="gOuter" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0e1a10"/><stop offset="100%" stopColor="#060c08"/>
            </radialGradient>
            <radialGradient id="gInner" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0c1610"/><stop offset="100%" stopColor="#050a07"/>
            </radialGradient>
            <filter id="glow"><feGaussianBlur stdDeviation="2.5" result="blur"/>
              <feComposite in="SourceGraphic" in2="blur" operator="over"/></filter>
          </defs>
          <circle cx={CX} cy={CY} r={R_BND+3} fill="url(#gOuter)"/>
          {SEGS.map(seg=>{
            const sel=isSel(seg.id),hv=hov?.seg===seg.id;
            const fill=viewMode==="heatmap"?(heatColor(segRuns[seg.id],maxR)||`${D.amber}0d`):sel?`rgba(79,70,229,.42)`:hv?`rgba(14,165,233,.16)`:`${D.amber}0c`;
            const stroke=sel?`rgba(79,70,229,.7)`:hv?`rgba(14,165,233,.4)`:`${D.amber}25`;
            return(<path key={`b${seg.id}`} d={ringArc(seg.angle,R_BND,R_MID)} fill={fill} stroke={stroke}
              strokeWidth={sel?"1.5":"0.5"} style={{cursor:onPlace?"crosshair":"pointer",pointerEvents:onPlace?"none":"auto"}}
              onClick={()=>onSel(sel&&selSeg?.zone==="boundary"?null:{seg:seg.id,zone:"boundary"})}
              onMouseEnter={()=>setHov({seg:seg.id})} onMouseLeave={()=>setHov(null)}/>);
          })}
          <circle cx={CX} cy={CY} r={R_MID} fill="none" stroke={`${D.amber}50`} strokeWidth="1.5" strokeDasharray="4 3"/>
          {SEGS.map(seg=>(
            <path key={`o${seg.id}`} d={ringArc(seg.angle,R_MID,R_IN)} fill={zoneFill(seg.id,"outer")}
              stroke={isSel(seg.id)?"rgba(79,70,229,.35)":"rgba(255,255,255,.04)"} strokeWidth="0.4" style={{cursor:onPlace?"crosshair":"pointer",pointerEvents:onPlace?"none":"auto"}}
              onClick={()=>onSel(isSel(seg.id)&&selSeg?.zone==="outer"?null:{seg:seg.id,zone:"outer"})}
              onMouseEnter={()=>setHov({seg:seg.id})} onMouseLeave={()=>setHov(null)}/>
          ))}
          <circle cx={CX} cy={CY} r={R_IN} fill="url(#gInner)" stroke="rgba(255,255,255,.1)" strokeWidth="1" strokeDasharray="3 4"/>
          {SEGS.map(seg=>(
            <path key={`i${seg.id}`} d={pieSlice(seg.angle,R_IN)} fill={zoneFill(seg.id,"inner")}
              stroke={isSel(seg.id)?"rgba(79,70,229,.25)":"rgba(255,255,255,.03)"} strokeWidth="0.4"
              style={{cursor:onPlace?"crosshair":"pointer",pointerEvents:onPlace?"none":"auto"}}
              onClick={()=>onSel(isSel(seg.id)&&selSeg?.zone==="inner"?null:{seg:seg.id,zone:"inner"})}
              onMouseEnter={()=>setHov({seg:seg.id})} onMouseLeave={()=>setHov(null)}/>
          ))}
          {SEGS.map(seg=>{const[xo,yo]=toXY(seg.angle-15,R_BND);return(
            <line key={`sp${seg.id}`} x1={CX} y1={CY} x2={xo} y2={yo} stroke="rgba(255,255,255,.05)" strokeWidth="0.5" style={{pointerEvents:"none"}}/>
          );})}
          {viewMode==="wagon"&&visLines.map((b,i)=>{
            const{xy:[ex,ey],synthetic}=wagEnd(ballAngle(b,batHand),b);
            const col=LK_COLS[lineKey(b)];
            const w=b.value===6?2.5:b.value===4?2:1.2;
            // Sector-era spokes are dashed. Their length is the band the ball
            // was recorded in, not a distance anyone measured, and a solid
            // line beside a captured one would claim otherwise.
            return(<line key={`wl${i}`} x1={CX} y1={CY} x2={ex} y2={ey} stroke={col} strokeWidth={w}
              strokeDasharray={synthetic?"2 2":undefined}
              opacity={b.value===0?0.25:0.72} strokeLinecap="round" className="wagonLine" style={{animationDelay:`${i*.02}s`}}/>);
          })}
          {viewMode==="wagon"&&visLines.filter(b=>b.value>=4).map((b,i)=>{
            const{xy:[ex,ey]}=wagEnd(ballAngle(b,batHand),b);
            const col=LK_COLS[lineKey(b)];
            return(<circle key={`dt${i}`} cx={ex} cy={ey} r={b.value===6?5.5:4} fill={col} opacity="0.95"
              style={{pointerEvents:"none",filter:b.value===6?"url(#glow)":"none"}}/>);
          })}
          {/* The capture surface. One transparent circle covering the whole
              field including beyond the rope, so a tap anywhere lands — the
              sector paths underneath keep their hover and selection behaviour
              only when point capture is off. */}
          {onPlace&&(
            <circle cx={CX} cy={CY} r={150} fill="transparent" style={{cursor:"crosshair"}}
              onPointerDown={(e)=>{e.currentTarget.setPointerCapture?.(e.pointerId);setPlacing(pointFromEvent(e));}}
              onPointerMove={(e)=>{if(placing)setPlacing(pointFromEvent(e));}}
              onPointerUp={(e)=>{const p=pointFromEvent(e)??placing;setPlacing(null);if(p)onPlace(p);}}
              onPointerCancel={()=>setPlacing(null)}/>
          )}
          {/* The live point, and the line to it. Shown before commit so the
              scorer can see what they are about to record and drag to refine. */}
          {placing&&(
            <g style={{pointerEvents:"none"}}>
              <line x1={CX} y1={CY} {...(()=>{const[x,y]=toXY(screenAngle(placing.theta,batHand),placing.radius*R_BND);return{x2:x,y2:y};})()}
                stroke={D.sky} strokeWidth="1.6" strokeLinecap="round" opacity="0.85"/>
              <circle {...(()=>{const[x,y]=toXY(screenAngle(placing.theta,batHand),placing.radius*R_BND);return{cx:x,cy:y};})()}
                r="5" fill={D.sky} opacity="0.95"/>
            </g>
          )}
          <rect x={CX-4.5} y={CY-R_PITCH} width={9} height={R_PITCH*2} rx="2.5" fill="#7c6e45" stroke={`${D.amber}60`} strokeWidth="0.7" style={{pointerEvents:"none"}}/>
          <line x1={CX-6} y1={CY-R_PITCH+3} x2={CX+6} y2={CY-R_PITCH+3} stroke="rgba(255,255,255,.55)" strokeWidth="0.8" style={{pointerEvents:"none"}}/>
          <line x1={CX-6} y1={CY+R_PITCH-3} x2={CX+6} y2={CY+R_PITCH-3} stroke="rgba(255,255,255,.55)" strokeWidth="0.8" style={{pointerEvents:"none"}}/>
          {[-2.8,0,2.8].map(x=>[
            <circle key={`st${x}`} cx={CX+x} cy={CY-R_PITCH+1.5} r="1.4" fill="rgba(255,255,255,.8)" style={{pointerEvents:"none"}}/>,
            <circle key={`sb${x}`} cx={CX+x} cy={CY+R_PITCH-1.5} r="1.4" fill="rgba(255,255,255,.8)" style={{pointerEvents:"none"}}/>
          ])}
          {SEGS.map(seg=>{
            const[lx,ly]=toXY(seg.angle,(R_IN+R_MID)/2+4);
            const sel=isSel(seg.id),hv=hov?.seg===seg.id;
            return(<text key={`lb${seg.id}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fontSize={sel||hv?"8":"7.5"} fontFamily="'Syne',sans-serif" fontWeight={sel||hv?"700":"400"}
              fill={sel?"#818cf8":hv?"#7dd3fc":"rgba(255,255,255,.32)"} style={{pointerEvents:"none"}}>{seg.short}</text>);
          })}
          {viewMode==="heatmap"&&SEGS.map(seg=>{
            if(!segRuns[seg.id])return null;
            const[lx,ly]=toXY(seg.angle,(R_IN+R_MID)/2+12);
            return(<text key={`hr${seg.id}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fontSize="8" fontFamily="'DM Mono',monospace" fontWeight="500"
              fill="rgba(255,255,255,.65)" style={{pointerEvents:"none"}}>{segRuns[seg.id]}</text>);
          })}
          <text x={9} y={CY} textAnchor="middle" dominantBaseline="middle" fontSize="6"
            fontFamily="'Syne',sans-serif" letterSpacing="1" fill="rgba(255,255,255,.18)"
            transform={`rotate(-90,9,${CY})`} style={{pointerEvents:"none"}}>OFF</text>
          <text x={291} y={CY} textAnchor="middle" dominantBaseline="middle" fontSize="6"
            fontFamily="'Syne',sans-serif" letterSpacing="1" fill="rgba(255,255,255,.18)"
            transform={`rotate(90,291,${CY})`} style={{pointerEvents:"none"}}>LEG</text>
        </svg>
      </div>
      <div style={{display:"flex",justifyContent:"center",gap:"5px",flexWrap:"wrap"}}>
        {Object.entries(LK_COLS).map(([k,col])=>{
          const off=hidden.has(k);
          return(<button key={k} onClick={()=>onToggle(k)} className="pressBtn" style={{
            display:"flex",alignItems:"center",gap:"5px",padding:"4px 10px",borderRadius:D.pill,
            cursor:"pointer",background:off?"transparent":`${col}12`,
            border:`1px solid ${off?D.border:`${col}38`}`,opacity:off?0.3:1,transition:"all .2s",
          }}>
            <div style={{width:"12px",height:"2px",borderRadius:"2px",background:off?D.textMuted:col}}/>
            <span style={{color:off?D.textMuted:D.textSecondary,fontSize:"10px",fontFamily:D.head,fontWeight:600,letterSpacing:"0.05em"}}>{k}</span>
          </button>);
        })}
      </div>
    </div>
  );
}

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
      boxShadow:`0 8px 40px rgba(0,0,0,.4),0 0 60px ${card.accent}08`,
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
          }}>{auto?"⏸":"▶"}</button>
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
        <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textMuted,marginBottom:"3px"}}>{i.battingTeam} · Innings {idx+1}</div>
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
                {b.status==="dnb"&&<span style={{color:D.textMuted,fontSize:"10px",fontFamily:D.body}}>(dnb)</span>}
              </div>
              {b.dismissal&&<div style={{color:D.textMuted,fontSize:"10px",marginTop:"2px",fontFamily:D.body,fontStyle:"italic"}}>{b.dismissal}</div>}
            </div>
            {[b.runs,b.balls,b.fours,b.sixes,SR(b.runs,b.balls)].map((v,j)=>(
              <div key={j} style={{textAlign:"right",fontFamily:D.mono,fontSize:"12px",fontWeight:j===0?"500":"400",
                color:j===2?D.indigo:j===3?D.amber:j===4?D.textMuted:D.textPrimary}}>{v}</div>
            ))}
          </div>
        ))}
        <div style={{padding:"7px 14px",display:"flex",justifyContent:"space-between"}}>
          <span style={{color:D.textMuted,fontSize:"10px",fontFamily:D.body}}>
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
                <span style={{color:D.rose,fontFamily:D.mono,fontSize:"12px",fontWeight:500}}>{f.runs}/{f.wickets}</span>
                <span style={{color:D.textMuted,fontSize:"10px",fontFamily:D.body,marginLeft:"5px"}}>{f.batsman} ({f.overs})</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      {/* Bowling */}
      <Card>
        {thRow(["Bowler","O","M","R","W","Econ"],"1fr 38px 24px 32px 26px 42px")}
        {bowled.map((b,ii)=>(
          <div key={b.id} style={{padding:"8px 14px",display:"grid",gridTemplateColumns:"1fr 38px 24px 32px 26px 42px",gap:"4px",
            background:ii%2?`${D.surf2}60`:"transparent",borderBottom:`1px solid ${D.border}`,alignItems:"center"}}>
            <span style={{color:D.textPrimary,fontSize:"13px",fontFamily:D.body,fontWeight:500}}>{b.name}</span>
            {[fmtOv(b.balls),b.maidens,b.runs,b.wickets,RR(b.runs,b.balls)].map((v,j)=>(
              <div key={j} style={{textAlign:"right",fontFamily:D.mono,fontSize:"12px",
                fontWeight:j===3?"500":"400",color:j===3?D.rose:D.textPrimary}}>{v}</div>
            ))}
          </div>
        ))}
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
    if(prev<50&&cur>=50)milestones.push({type:"fifty",label:"FIFTY!",sub:bat.name+" reaches 50",color:D.sky,icon:"🏏"});
    if(prev<100&&cur>=100)milestones.push({type:"century",label:"CENTURY!",sub:bat.name+" — 100 not out",color:D.amber,icon:"💯"});
    if(prev<150&&cur>=150)milestones.push({type:"150",label:"150!",sub:bat.name+" on 150",color:D.amber,icon:"🔥"});
    if(prev<200&&cur>=200)milestones.push({type:"200",label:"DOUBLE!",sub:bat.name+" — 200 runs!",color:D.amber,icon:"👑"});
  }
  if(bow&&ball.type==="W"){
    const wkts=(bow.wickets||0)+1; // including this dismissal
    if(wkts===5)milestones.push({type:"fifer",label:"FIFER!",sub:bow.name+" takes 5 wickets",color:D.rose,icon:"🎯"});
    if(wkts>=3){
      const legal=(inn?.ballLog||[]).filter(b=>b.type!=="Wd"&&b.type!=="Nb").slice(-2);
      if(legal.length===2&&legal.every(b=>b.type==="W"&&b.bowler===bow.id))
        milestones.push({type:"hattrick",label:"HAT-TRICK!",sub:bow.name+" — 3 in a row!",color:D.rose,icon:"🎩"});
    }
    if((inn?.wickets||0)+1>=10)milestones.push({type:"allout",label:"ALL OUT!",sub:(inn?.battingTeam||"")+" all out",color:D.rose,icon:"💀"});
  }
  // Team milestones — total includes extras
  if(inn){
    const added=(ball.type==="Wd"||ball.type==="Nb")?1+(ball.value||0):(ball.value||0);
    const prevRuns=inn.runs, postRuns=inn.runs+added;
    [50,100,150,200,250,300,350,400].forEach(n=>{
      if(prevRuns<n&&postRuns>=n)milestones.push({type:"team"+n,label:n+"!",sub:inn.battingTeam+" reach "+n,color:D.indigo,icon:"🏏"});
    });
  }
  return milestones.length>0?milestones[0]:null;
}

/* ═══════════════════════════════════════════════════════
   COMMENTARY CARD  (top-level, used inside Score tab)
═══════════════════════════════════════════════════════ */
function CommentaryCard({inn}){
  const log=[...(inn?.ballLog||[])].reverse().slice(0,8);
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
  const descBall=(b)=>{
    if(b.type==="W")return "WICKET — "+b.dismissal;
    if(b.type==="Wd")return "Wide ball";
    if(b.type==="Nb")return "No Ball ("+(b.nbType||"front foot").replace("_"," ")+"), "+(b.value||0)+"+1 runs";
    if(b.type==="Pen")return "Penalty "+b.value+" runs — "+(b.reason||"");
    if(b.type==="B")return "Bye — "+b.value+" run"+(b.value!==1?"s":"");
    if(b.type==="LB")return "Leg Bye — "+b.value+" run"+(b.value!==1?"s":"");
    if(b.value===6)return "SIX! Maximum";
    if(b.value===4)return "FOUR! Boundary";
    if(b.value===0)return "Dot ball";
    return b.value+" run"+(b.value!==1?"s":"");
  };
  return (
    <Card style={{overflow:"hidden"}}>
      <div style={{padding:"10px 14px 9px",borderBottom:"1px solid "+D.border,
        display:"flex",alignItems:"center",gap:"8px"}}>
        <Lbl>Commentary</Lbl>
        {loading&&<div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted,fontStyle:"italic"}}>AI writing…</div>}
        <div className="liveDot" style={{width:"5px",height:"5px",borderRadius:"50%",
          background:D.emerald,marginLeft:"auto",flexShrink:0}}/>
      </div>
      {log.length===0&&(
        <div style={{padding:"16px 14px",color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>
          No balls bowled yet.
        </div>
      )}
      {log.map((b,i)=>{
        const shot=b.shot?ALL_SHOTS_FLAT.find(s=>s.id===b.shot):null;
        const seg=b.seg!=null?SEGS[b.seg]:null;
        const first=i===0;
        const isWkt=b.type==="W";
        const isSix=b.value===6&&b.type==="run";
        const isFour=b.value===4&&b.type==="run";
        const accentCol=isWkt?D.rose:isSix?D.amber:isFour?D.sky:null;
        const bkey=getBallKey(b);
        const aiLine=aiLines[bkey];
        // Left accent stripe colour
        const stripeCol=isWkt?D.rose:isSix?D.amber:isFour?D.sky:first?D.indigo+"55":"transparent";
        return (
          <div key={i} style={{
            display:"flex",alignItems:"flex-start",gap:"0",
            background:first?(isWkt?D.rose+"07":isSix?D.amber+"07":isFour?D.sky+"06":D.indigo+"07"):"transparent",
            borderBottom:i<log.length-1?"1px solid "+D.border:"none",
            opacity:Math.max(0.25,1-i*0.1),
            borderLeft:"3px solid "+stripeCol,
          }}>
            <div style={{padding:"9px 10px 9px 12px",flexShrink:0}}>
              <BallDot ball={b} size={22}/>
            </div>
            <div style={{flex:1,minWidth:0,padding:"9px 12px 9px 0"}}>
              {/* Over + ball indicator */}
              <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"3px"}}>
                <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,flexShrink:0}}>
                  {(b.over+1)}.{b.ballInOver+1}
                </span>
                {b.bowlerApproach&&<Badge color={D.amber} sx={{fontSize:"9px",padding:"1px 5px"}}>{b.bowlerApproach==="Around the wicket"?"Around":"Over"}</Badge>}
                {isWkt&&<Badge color={D.rose} sx={{fontSize:"9px",padding:"1px 5px"}}>WICKET</Badge>}
                {isSix&&<Badge color={D.amber} sx={{fontSize:"9px",padding:"1px 5px"}}>SIX</Badge>}
                {isFour&&<Badge color={D.sky} sx={{fontSize:"9px",padding:"1px 5px"}}>FOUR</Badge>}
              </div>
              {/* AI commentary line */}
              {aiLine&&(
                <div style={{fontFamily:D.body,fontSize:first?"13px":"12px",fontWeight:first?500:400,
                  color:accentCol||D.textPrimary,marginBottom:"4px",lineHeight:1.45}}>
                  {aiLine}
                </div>
              )}
              {/* Fallback mechanical description */}
              {!aiLine&&(
                <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:first?600:400,
                  color:accentCol||D.textPrimary}}>
                  {first&&loading?"Generating commentary…":descBall(b)}
                </div>
              )}
              {/* Metadata tags */}
              <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"2px",
                display:"flex",gap:"7px",flexWrap:"wrap",alignItems:"center"}}>
                {shot&&<span style={{color:shot.color}}>{shot.icon+" "+shot.label}</span>}
                {seg&&<span>{"📍 "+seg.label+(b.zone==="boundary"?" · Boundary":"")}</span>}
                {b.bowlerApproach&&<span style={{color:D.amber}}>{"⤵ "+b.bowlerApproach}</span>}
                <span>{"Ov "+(b.over+1)+"."+(b.ballInOver+1)}</span>
              </div>
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
/* ═══════════════════════════════════════════════════════
   EVENT OVERLAY — fullscreen flash for 4, 6, WICKET, milestones
═══════════════════════════════════════════════════════ */
// event: {label,sub,color,glow,bg,icon?,isMilestone?}
function EventOverlay({event,onDone,suppressBlur}){
  const[phase,setPhase]=useState("in");
  const duration=event?.isMilestone?2400:1700;
  // Re-arm per event: when the parent chains a queued overlay (e.g. SIX →
  // FIFTY) the component stays mounted with a new `event` prop. A mount-only
  // effect would never schedule timers for the second overlay, leaving the
  // blurred backdrop on screen permanently.
  useEffect(()=>{
    if(!event)return;
    setPhase("in");
    const t1=setTimeout(()=>setPhase("out"),duration-400);
    const t2=setTimeout(onDone,duration);
    return()=>{clearTimeout(t1);clearTimeout(t2);};
  },[event]);
  if(!event)return null;
  const {label,sub,color,glow,bg,icon,isMilestone}=event;
  // Confetti pieces for milestones
  const confetti=isMilestone?Array.from({length:18},(_,i)=>({
    x:Math.sin(i/18*Math.PI*2)*120,
    delay:(i*0.08)%0.7,
    col:["#f59e0b","#0ea5e9","#10b981","#f43f5e","#7c3aed","#f97316"][i%6],
    rot:i*23,
  })):[];
  // Blocking blur is suppressed whenever a sheet/modal is open, evaluated
  // live at render time so it stays correct for queued overlays too.
  const nb=event?.noBlur||suppressBlur;
  return (
    <div style={{
      position:"fixed",inset:0,zIndex:nb?200:9999,pointerEvents:"none",
      background:nb?"transparent":(bg||"rgba(0,0,0,.1)"),
      backdropFilter:nb?"none":"blur(2px)",
    }}>
      <div style={{
        position:"absolute",top:"50%",left:"50%",
        animation:phase==="in"
          ?(isMilestone?"milestoneIn .5s cubic-bezier(.22,1,.36,1) both":"overlayIn .4s cubic-bezier(.22,1,.36,1) both")
          :"milestoneOut .45s ease forwards",
        textAlign:"center",
      }}>
        {/* Icon for milestones */}
        {icon&&<div style={{fontSize:"clamp(40px,8vw,70px)",lineHeight:1,marginBottom:"8px"}}>{icon}</div>}
        <div style={{
          fontFamily:D.mono,
          fontSize:isMilestone?"clamp(52px,12vw,96px)":"clamp(60px,14vw,110px)",
          fontWeight:700,lineHeight:1,
          color,
          textShadow:`0 0 40px ${glow||color+"88"},0 0 80px ${glow||color+"44"},0 4px 0 rgba(0,0,0,.5)`,
          letterSpacing:"-0.02em",
          ...(isMilestone?{
            background:"linear-gradient(135deg,"+color+","+color+"99,"+color+")",
            backgroundSize:"200% auto",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",
            animation:"goldShimmer 1.2s linear infinite",
          }:{}),
        }}>{label}</div>
        <div style={{
          fontFamily:D.head,fontSize:"clamp(14px,3vw,22px)",fontWeight:700,
          letterSpacing:"0.2em",color,opacity:.8,
          textTransform:"uppercase",marginTop:"8px",
          animation:isMilestone?"bounceIn .5s .2s cubic-bezier(.22,1,.36,1) both":"none",
        }}>{sub}</div>
        {/* Radiating rings */}
        {[0,1,2].map(i=>(
          <div key={i} style={{
            position:"absolute",top:"50%",left:"50%",borderRadius:"50%",
            transform:"translate(-50%,-50%)",
            width:((i+1)*(isMilestone?220:180))+"px",height:((i+1)*(isMilestone?220:180))+"px",
            border:"2px solid "+color,opacity:0,
            animation:`fadeIn .1s ${0.05+i*0.12}s forwards, overlayOut .7s ${0.2+i*0.12}s forwards`,
          }}/>
        ))}
        {/* Confetti for milestones */}
        {confetti.map((c,i)=>(
          <div key={i} style={{
            position:"absolute",top:"50%",left:"50%",
            width:"8px",height:"8px",borderRadius:"2px",
            background:c.col,
            transform:`translate(calc(-50% + ${c.x}px), -50%) rotate(${c.rot}deg)`,
            opacity:0,
            animation:`confetti .9s ${c.delay}s ease-out forwards`,
          }}/>
        ))}
      </div>
    </div>
  );
}

// Build event config from ball value or milestone object
function buildEventCfg(ballValue,milestone){
  if(milestone)return{
    label:milestone.label,sub:milestone.sub,
    color:milestone.color,bg:milestone.color+"08",
    icon:milestone.icon,isMilestone:true,
  };
  if(ballValue===4)return{label:"FOUR!",sub:"Boundary",color:D.sky,glow:"rgba(14,165,233,.5)",bg:"rgba(14,165,233,.06)"};
  if(ballValue===6)return{label:"SIX!",sub:"Maximum!",color:D.amber,glow:"rgba(245,158,11,.6)",bg:"rgba(245,158,11,.06)"};
  if(ballValue==="W")return{label:"WICKET!",sub:"Out",color:D.rose,glow:"rgba(244,63,94,.5)",bg:"rgba(244,63,94,.06)"};
  return null;
}

/* ═══════════════════════════════════════════════════════
   FREE HIT BANNER — shown when next ball is a free hit
═══════════════════════════════════════════════════════ */
function FreeHitBanner({onDismiss}){
  return (
    <div style={{
      position:"fixed",top:"72px",left:"50%",transform:"translateX(-50%)",
      zIndex:1000,padding:"10px 24px",borderRadius:D.pill,
      background:"linear-gradient(135deg,#f97316,#f59e0b)",
      boxShadow:"0 0 0 4px rgba(249,115,22,.3)",
      animation:"freeHitPulse 1s ease infinite, bounceIn .4s cubic-bezier(.22,1,.36,1)",
      display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",
    }} onClick={onDismiss}>
      <span style={{fontSize:"20px"}}>⚡</span>
      <div>
        <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:800,color:"#fff",letterSpacing:"0.1em"}}>FREE HIT!</div>
        <div style={{fontFamily:D.body,fontSize:"10px",color:"rgba(255,255,255,.8)"}}>Next ball: batter can only be run out</div>
      </div>
      <span style={{fontSize:"20px"}}>⚡</span>
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
                <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted,textAlign:"center"}}>{cur?.balls||0}b</div>
              </div>
              {(cur?.balls||0)>0&&(
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:D.mono,fontSize:"12px",color:D.textSecondary}}>{RR(cur.runs,cur.balls)}</div>
                  <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>RR</div>
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
                  <span style={{fontFamily:D.mono,fontSize:"10px",color:D.rose,fontWeight:600}}>{p.wicket-1}/{p.wicket}</span>
                  <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{p.bat1} & {p.bat2}</span>
                </div>
                <div style={{display:"flex",gap:"10px",alignItems:"baseline"}}>
                  <span style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:D.textPrimary}}>{p.runs}</span>
                  <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{p.balls}b</span>
                  <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textSecondary}}>{RR(p.runs,p.balls)}</span>
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

export { CommentaryCard, DynamicBar, EventOverlay, FreeHitBanner, IntelPanel, PartnershipCard, ScorecardPanel, WagonWheel, buildEventCfg, detectMilestone };
