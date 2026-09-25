import { useState } from "react";
import { D, T, textOn } from "../design/tokens.js";
import { CX, CY, LK_COLS, R_BND, R_IN, R_MID, R_PITCH, SEGS, ballAngle, lineKey, toXY, wagEnd } from "./field.js";
import { RR, SR } from "./format.js";
import { IntelPanel } from "./panels.jsx";
import { buildSignals } from "./signals.js";
import { Badge, Card, Lbl, SignalBar } from "./ui.jsx";
import { batHandOf, hasPoint, positionName, screenAngle, shotDensity, directionalProfile, DISMISSAL_LABEL, placementEvidence, NOT_CAPTURED, PLACEMENT_FIELD, runsOffBat } from "@scrbrd/scoring";

/* ═══════════════════════════════════════════════════════
   INTEL DASHBOARD TAB
═══════════════════════════════════════════════════════ */
/* ──────────────────────────────
   ANALYSIS CHARTS
────────────────────────────── */
function WormChart({innings,curIn,match}){
  const overs=match?.overs||20;
  const maxBalls=overs*6;
  const inn1=innings[0];const inn2=innings[1];
  // Build worm data points per ball from each innings
  const mkWorm=(inn)=>{
    if(!inn||!inn.ballLog.length)return{pts:[],wkts:[]};
    const pts=[{ball:0,runs:0}];const wkts=[];
    let runs=0;
    inn.ballLog.filter(b=>b.type!=="Wd"&&b.type!=="Nb"&&b.type!=="Pen").forEach((b,i)=>{
      runs+=(b.value||0);
      const ball=i+1;
      pts.push({ball,runs});
      if(b.type==="W"){
        const bat=inn.batsmen.find(x=>x.id===b.striker);
        wkts.push({ball,runs,n:wkts.length+1,name:bat?bat.name:(DISMISSAL_LABEL[b.dismissal]||b.dismissal||"Wicket"),mode:DISMISSAL_LABEL[b.dismissal]||b.dismissal||""});
      }
    });
    return{pts,wkts};
  };
  const d1=mkWorm(inn1),d2=mkWorm(inn2);
  const w1=d1.pts,w2=d2.pts;const wk1=d1.wkts,wk2=d2.wkts;
  const maxR=Math.max(20,...w1.map(p=>p.runs),...w2.map(p=>p.runs));
  const W=500,H=160,PAD={t:16,r:12,b:28,l:40};
  const cw=W-PAD.l-PAD.r,ch=H-PAD.t-PAD.b;
  const xScale=b=>(b/maxBalls)*cw;
  const yScale=r=>ch-(r/maxR)*ch;
  const mkPath=(pts)=>pts.length<2?"":pts.map((p,i)=>(i===0?"M":"L")+((xScale(p.ball))+","+yScale(p.runs).toFixed(1))).join(" ");
  const xTicks=Array.from({length:overs+1},(_,i)=>i);
  const yTicks=[0,Math.round(maxR/4),Math.round(maxR/2),Math.round(3*maxR/4),maxR];
  return (
    <Card style={{padding:"14px 16px"}}>
      <Lbl sx={{marginBottom:"10px"}}>Worm — Runs & Wickets</Lbl>
      <svg width="100%" viewBox={"0 0 "+W+" "+H} preserveAspectRatio="xMidYMid meet" style={{overflow:"visible"}}>
        <g transform={"translate("+PAD.l+","+PAD.t+")"}>
          {/* Grid */}
          {yTicks.map(v=>(
            <g key={v}>
              <line x1={0} y1={yScale(v)} x2={cw} y2={yScale(v)} stroke={D.border} strokeWidth={1}/>
              <text x={-6} y={yScale(v)+4} textAnchor="end" fill={D.textMuted} fontSize={9} fontFamily={D.mono}>{v}</text>
            </g>
          ))}
          {xTicks.filter(v=>v%5===0).map(v=>(
            <text key={v} x={xScale(v*6)} y={ch+16} textAnchor="middle" fill={D.textMuted} fontSize={9} fontFamily={D.mono}>{v}</text>
          ))}
          {/* Worm lines */}
          {w1.length>1&&<path d={mkPath(w1)} fill="none" stroke={D.sky} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.9}/>}
          {w2.length>1&&<path d={mkPath(w2)} fill="none" stroke={D.amber} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.9}/>}
          {/* Area fills */}
          {w1.length>1&&<path d={mkPath(w1)+"L"+xScale(w1[w1.length-1].ball)+","+ch+"L0,"+ch+"Z"} fill={D.sky} opacity={0.06}/>}
          {w2.length>1&&<path d={mkPath(w2)+"L"+xScale(w2[w2.length-1].ball)+","+ch+"L0,"+ch+"Z"} fill={D.amber} opacity={0.06}/>}
          {/* Axes */}
          <line x1={0} y1={0} x2={0} y2={ch} stroke={D.border} strokeWidth={1}/>
          <line x1={0} y1={ch} x2={cw} y2={ch} stroke={D.border} strokeWidth={1}/>
          {/* Wicket markers — drop-line to the over axis + labelled node */}
          {[[wk1,D.sky],[wk2,D.amber]].map(([wk,col],gi)=>wk.map((m,i)=>(
            <g key={gi+"-"+i}>
              <line x1={xScale(m.ball)} y1={yScale(m.runs)} x2={xScale(m.ball)} y2={ch} stroke={D.rose} strokeWidth={1} strokeDasharray="2 3" opacity={0.4}/>
              <circle cx={xScale(m.ball)} cy={yScale(m.runs)} r={4.5} fill={D.rose} stroke={col} strokeWidth={1.5}>
                <title>{"W"+m.n+" · "+m.runs+" ("+m.name+(m.mode?", "+m.mode:"")+")"}</title>
              </circle>
            </g>
          )))}
        </g>
      </svg>
      <div style={{display:"flex",gap:"16px",marginTop:"8px"}}>
        {inn1&&<div style={{display:"flex",alignItems:"center",gap:"5px"}}>
          <div style={{width:"18px",height:"2px",background:D.sky,borderRadius:"1px"}}/>
          <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{inn1.battingTeam}</span>
        </div>}
        {inn2&&inn2.ballLog.length>0&&<div style={{display:"flex",alignItems:"center",gap:"5px"}}>
          <div style={{width:"18px",height:"2px",background:D.amber,borderRadius:"1px"}}/>
          <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{inn2.battingTeam}</span>
        </div>}
        {(wk1.length>0||wk2.length>0)&&<div style={{display:"flex",alignItems:"center",gap:"5px"}}>
          <div style={{width:"9px",height:"9px",borderRadius:"50%",background:D.rose,border:`1.5px solid ${D.surf1}`}}/>
          <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Wicket</span>
        </div>}
      </div>
    </Card>
  );
}

function ManhattanChart({inn,match}){
  const overs=match?.overs||20;
  if(!inn||!inn.overLog.length)return(
    <Card style={{padding:"14px 16px"}}>
      <Lbl sx={{marginBottom:"8px"}}>Manhattan — Runs per Over</Lbl>
      <div style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px",padding:"16px 0"}}>No completed overs yet.</div>
    </Card>
  );
  const ovData=Array.from({length:overs},(_,i)=>{
    const ov=inn.overLog.find(o=>o.over===i);
    if(!ov)return{over:i,runs:0,wickets:0,complete:false};
    const runs=ov.balls.reduce((s,b)=>s+(b.value||0),0);
    const wickets=ov.balls.filter(b=>b.type==="W").length;
    const complete=ov.balls.filter(b=>b.type!=="Wd"&&b.type!=="Nb").length===6;
    return{over:i,runs,wickets,complete};
  });
  const maxR=Math.max(1,...ovData.map(o=>o.runs));
  const W=500,H=150,PAD={t:12,r:8,b:28,l:32};
  const cw=W-PAD.l-PAD.r,ch=H-PAD.t-PAD.b;
  const barW=Math.max(4,cw/overs-2);
  const barColor=(r,w)=>w>0?D.rose:r>=12?D.amber:r>=8?D.sky:D.indigo;
  return (
    <Card style={{padding:"14px 16px"}}>
      <Lbl sx={{marginBottom:"10px"}}>Manhattan — Runs per Over</Lbl>
      <svg width="100%" viewBox={"0 0 "+W+" "+H} preserveAspectRatio="xMidYMid meet" style={{overflow:"visible"}}>
        <g transform={"translate("+PAD.l+","+PAD.t+")"}>
          {[0,Math.round(maxR/2),maxR].map(v=>(
            <g key={v}>
              <line x1={0} y1={ch-(v/maxR)*ch} x2={cw} y2={ch-(v/maxR)*ch} stroke={D.border} strokeWidth={1}/>
              <text x={-5} y={ch-(v/maxR)*ch+4} textAnchor="end" fill={D.textMuted} fontSize={8} fontFamily={D.mono}>{v}</text>
            </g>
          ))}
          {ovData.filter(o=>o.complete||o.over<Math.floor((inn.balls||0)/6)).map((o,i)=>{
            const bh=(o.runs/maxR)*ch;
            const bx=(i/overs)*cw+(cw/overs-barW)/2;
            const by=ch-bh;
            return (
              <g key={i}>
                <rect x={bx} y={by} width={barW} height={Math.max(1,bh)}
                  fill={barColor(o.runs,o.wickets)} opacity={0.8} rx={2}/>
                {o.wickets>0&&<text x={bx+barW/2} y={Math.max(by-3,2)} textAnchor="middle" fill={D.rose} fontSize={8} fontFamily={D.mono}>{"W".repeat(o.wickets)}</text>}
                {overs<=20&&<text x={bx+barW/2} y={ch+14} textAnchor="middle" fill={D.textMuted} fontSize={8} fontFamily={D.mono}>{o.over+1}</text>}
              </g>
            );
          })}
          <line x1={0} y1={ch} x2={cw} y2={ch} stroke={D.border} strokeWidth={1}/>
        </g>
      </svg>
      <div style={{display:"flex",gap:"12px",marginTop:"6px",flexWrap:"wrap"}}>
        {[{c:D.indigo,l:"0–7"},{c:D.sky,l:"8–11"},{c:D.amber,l:"12+"},{c:D.rose,l:"Wicket"}].map(({c,l})=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:"4px"}}>
            <div style={{width:"10px",height:"10px",borderRadius:"2px",background:c,opacity:.85}}/>
            <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{l}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RunRateChart({inn,match,target}){
  const overs=match?.overs||20;
  if(!inn||!inn.overLog.length)return null;
  // Build RR per over and required RR per over
  const pts=[];let cumRuns=0;
  for(let ov=0;ov<overs;ov++){
    const ovLog=inn.overLog.find(o=>o.over===ov);
    if(!ovLog)break;
    const legalBalls=ovLog.balls.filter(b=>b.type!=="Wd"&&b.type!=="Nb").length;
    if(legalBalls<6)break;
    cumRuns+=ovLog.balls.reduce((s,b)=>s+(b.value||0),0);
    const rr=cumRuns/((ov+1));
    const ballsDone=(ov+1)*6;
    const reqRr=target?Math.max(0,(target-cumRuns)/((overs*6-ballsDone)/6)):null;
    pts.push({over:ov+1,rr,reqRr});
  }
  if(pts.length<2)return null;
  const maxRR=Math.max(12,...pts.map(p=>Math.max(p.rr,p.reqRr||0)));
  const W=500,H=130,PAD={t:12,r:8,b:26,l:36};
  const cw=W-PAD.l-PAD.r,ch=H-PAD.t-PAD.b;
  const xS=v=>(v/overs)*cw;const yS=v=>ch-Math.min(1,v/maxRR)*ch;
  const mkP=(pts,key)=>pts.map((p,i)=>(i===0?"M":"L")+xS(p.over)+","+yS(p[key]).toFixed(1)).join(" ");
  return (
    <Card style={{padding:"14px 16px"}}>
      <Lbl sx={{marginBottom:"10px"}}>Run Rate</Lbl>
      <svg width="100%" viewBox={"0 0 "+W+" "+H} preserveAspectRatio="xMidYMid meet" style={{overflow:"visible"}}>
        <g transform={"translate("+PAD.l+","+PAD.t+")"}>
          {[0,Math.round(maxRR/2),maxRR].map(v=>(
            <g key={v}>
              <line x1={0} y1={yS(v)} x2={cw} y2={yS(v)} stroke={D.border} strokeWidth={1}/>
              <text x={-5} y={yS(v)+4} textAnchor="end" fill={D.textMuted} fontSize={8} fontFamily={D.mono}>{v.toFixed(0)}</text>
            </g>
          ))}
          <path d={mkP(pts,"rr")} fill="none" stroke={D.emerald} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
          <path d={mkP(pts,"rr")+"L"+xS(pts[pts.length-1].over)+","+ch+"L0,"+ch+"Z"} fill={D.emerald} opacity={0.06}/>
          {target&&<path d={mkP(pts.filter(p=>p.reqRr!=null),"reqRr")} fill="none" stroke={D.rose} strokeWidth={1.5} strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round"/>}
          <line x1={0} y1={0} x2={0} y2={ch} stroke={D.border} strokeWidth={1}/>
          <line x1={0} y1={ch} x2={cw} y2={ch} stroke={D.border} strokeWidth={1}/>
          {pts.filter((_,i)=>i%5===4||(i===pts.length-1)).map(p=>(
            <text key={p.over} x={xS(p.over)} y={ch+14} textAnchor="middle" fill={D.textMuted} fontSize={8} fontFamily={D.mono}>{p.over}</text>
          ))}
        </g>
      </svg>
      <div style={{display:"flex",gap:"14px",marginTop:"6px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
          <div style={{width:"16px",height:"2px",background:D.emerald,borderRadius:"1px"}}/>
          <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Run Rate</span>
        </div>
        {target&&<div style={{display:"flex",alignItems:"center",gap:"5px"}}>
          <div style={{width:"16px",height:"2px",background:D.rose,borderRadius:"1px",borderTop:"2px dashed "+D.rose}}/>
          <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Required RR</span>
        </div>}
      </div>
    </Card>
  );
}

function BatsmanChart({inn}){
  if(!inn)return null;
  const batters=inn.batsmen.filter(b=>b.balls>0).sort((a,b2)=>b2.runs-a.runs).slice(0,6);
  if(!batters.length)return null;
  const maxR=Math.max(1,...batters.map(b=>b.runs));
  return (
    <Card style={{padding:"14px 16px"}}>
      <Lbl sx={{marginBottom:"10px"}}>Top Batsmen</Lbl>
      <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
        {batters.map((b,i)=>{
          const pct=b.runs/maxR;
          const sr=b.balls>0?(b.runs/b.balls*100).toFixed(0):0;
          const col=i===0?D.amber:i===1?D.sky:D.indigo;
          return (
            <div key={b.id}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"3px"}}>
                <span style={{fontFamily:D.body,fontSize:"12px",color:b.status==="batting"?D.emerald:D.textSecondary,fontWeight:500}}>{b.name}{b.status==="batting"?"*":""}</span>
                <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textPrimary}}>{b.runs}<span style={{color:D.textMuted,fontSize:"10px"}}> ({b.balls}b · SR {sr})</span></span>
              </div>
              <div style={{height:"6px",borderRadius:"3px",background:D.surf2,overflow:"hidden"}}>
                <div style={{height:"100%",width:(pct*100)+"%",borderRadius:"3px",background:col,transition:"width .5s ease"}}/>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function BowlerChart({inn}){
  if(!inn)return null;
  const bowlers=inn.bowlers.filter(b=>b.balls>0).sort((a,b2)=>b2.wickets-a.wickets||a.runs-b2.runs).slice(0,6);
  if(!bowlers.length)return null;
  const maxWkt=Math.max(1,...bowlers.map(b=>b.wickets));
  const maxR=Math.max(1,...bowlers.map(b=>b.runs));
  return (
    <Card style={{padding:"14px 16px"}}>
      <Lbl sx={{marginBottom:"10px"}}>Bowling Performance</Lbl>
      <div style={{display:"flex",flexDirection:"column",gap:"9px"}}>
        {bowlers.map((b,i)=>{
          const econ=(b.balls>0?b.runs/(b.balls/6):0).toFixed(2);
          const econCol=parseFloat(econ)<6?D.emerald:parseFloat(econ)<9?D.amber:D.rose;
          return (
            <div key={b.id} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:"8px",alignItems:"center",
              padding:"8px 10px",background:D.surf2,borderRadius:D.md,
              border:"1px solid "+(b.id===inn.bowler?D.orange+"44":D.border)}}>
              <span style={{fontFamily:D.body,fontSize:"12px",color:b.id===inn.bowler?D.orange:D.textPrimary,fontWeight:500}}>{b.name}{b.id===inn.bowler?"*":""}</span>
              <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textMuted}}>{Math.floor(b.balls/6)+"-"+(b.balls%6)}</span>
              <span style={{fontFamily:D.mono,fontSize:"12px",color:b.wickets>0?textOn(D.rose):D.textSecondary,fontWeight:b.wickets?"600":"400"}}>{b.wickets+"W-"+b.runs+"R"}</span>
              <Badge color={econCol} sx={{fontSize:"9px"}}>{econ}</Badge>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * The wagon wheel, for people who are not the scorer.
 *
 * The scorer's own wheel (panels.jsx) is a capture surface: it takes taps,
 * holds a selection, and belongs to the person with the phone. This one only
 * reads. It exists because the wheel was, until now, the private property of
 * whoever happened to be scoring — a coach reviewing Saturday, a parent
 * looking at their son's innings and the boy himself had no way to see where
 * a single ball went, though every one of those placements was recorded.
 *
 * WHAT IT REFUSES TO DO
 * ─────────────────────
 * Draw a ball it does not have a position for. A leave, a ball into the pad
 * and a delivery scored on a QUICK profile carry no placement, and the count
 * of them is REPORTED rather than quietly dropped — a wheel with eleven spokes
 * over an innings of ninety is telling you about the scorer, not the batter,
 * and it should say so.
 *
 * Sector-era balls are drawn dashed, at their band, exactly as the scorer's
 * wheel draws them: their length is the ring they were recorded in, never a
 * distance anyone measured. See wagEnd() in field.js.
 *
 * Handedness is resolved PER BALL from the striker each one carries, because
 * an innings has two ends and a side has both kinds of batter.
 */
function ShotWheel({inn,playerId=null,title="Wagon wheel"}){
  if(!inn)return null;
  const log=inn.ballLog||[];
  const mine=playerId?log.filter(b=>b.strikerId===playerId):log;
  // A ball is drawable if it has a captured point or a sector. Anything else
  // — a leave, a pad, an unassessed delivery — has no position at all.
  const drawn=mine.filter(b=>b.theta!=null||b.seg!=null);
  const exact=drawn.filter(hasPoint).length;
  const missing=mine.length-drawn.length;
  // One batter's wheel counts his runs — not byes, even off a no-ball
  // (runsOffBat, SCRBRD-068); the side's counts everything run.
  const runs=mine.reduce((s,b)=>s+(playerId?runsOffBat(b):(b.value||0)),0);
  return (
    <Card style={{padding:"14px 16px"}}>
      <div style={{display:"flex",alignItems:"baseline",gap:"8px",marginBottom:"10px"}}>
        <Lbl>{title}</Lbl>
        <span style={{marginLeft:"auto",fontFamily:D.mono,fontSize:"11px",color:D.textSecondary}}>
          {runs} run{runs===1?"":"s"} · {drawn.length} shown
        </span>
      </div>
      {drawn.length===0?(
        <div style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px",padding:"18px 0",textAlign:"center"}}>
          {mine.length
            ?`No placements recorded for ${mine.length} ball${mine.length===1?"":"s"}.`
            :"No balls faced."}
        </div>
      ):(
        <div style={{width:"100%",maxWidth:"260px",margin:"0 auto",aspectRatio:"1"}}>
          <svg viewBox="0 0 300 300" style={{width:"100%",height:"100%",display:"block"}}
            role="img"
            aria-label={`Wagon wheel: ${drawn.length} shot${drawn.length===1?"":"s"}, ${exact} placed exactly, ${runs} runs`}>
            <circle cx={CX} cy={CY} r={R_BND+3} fill={T.field.ground} stroke={`${D.amber}30`} strokeWidth="1"/>
            <circle cx={CX} cy={CY} r={R_MID} fill="none" stroke={`${D.amber}30`} strokeWidth="1" strokeDasharray="4 3"/>
            <circle cx={CX} cy={CY} r={R_IN} fill="none" stroke={T.field.rule} strokeWidth="1" strokeDasharray="3 4"/>
            {/* Sector guides, faint. Orientation only — the shots are the data. */}
            {SEGS.map(s=>{const[x,y]=toXY(s.angle-15,R_BND);return(
              <line key={`g${s.id}`} x1={CX} y1={CY} x2={x} y2={y} stroke={T.field.hairline} strokeWidth="0.5"/>);})}
            {drawn.map((b,i)=>{
              const{xy:[ex,ey],synthetic}=wagEnd(ballAngle(b,batHandOf(inn,b.strikerId)),b);
              const col=LK_COLS[lineKey(b)];
              // The fielding position, DERIVED from the point rather than
              // stored on it — so the naming table can be corrected later
              // without touching a single ball. Only a captured point has one;
              // a sector-era ball knows its wedge, not its position.
              const where=hasPoint(b)?positionName(b.theta,b.radius):null;
              const over=b.over!=null?` (${b.over+1}.${(b.ballInOver??0)+1})`:"";
              return(<line key={`l${i}`} x1={CX} y1={CY} x2={ex} y2={ey} stroke={col}
                strokeWidth={b.value===6?2.5:b.value===4?2:1.2}
                strokeDasharray={synthetic?"2 2":undefined}
                opacity={b.value===0?0.25:0.72} strokeLinecap="round">
                <title>{`${b.type==="W"?"Wicket":`${b.value||0} run${b.value===1?"":"s"}`}${where?` — ${where}`:""}${over}`}</title>
              </line>);
            })}
            {drawn.filter(b=>b.value>=4).map((b,i)=>{
              const{xy:[ex,ey]}=wagEnd(ballAngle(b,batHandOf(inn,b.strikerId)),b);
              return(<circle key={`d${i}`} cx={ex} cy={ey} r={b.value===6?5:3.5} fill={LK_COLS[lineKey(b)]} opacity="0.95"/>);
            })}
            <rect x={CX-4.5} y={CY-R_PITCH} width={9} height={R_PITCH*2} rx="2.5" fill={T.field.pitch} stroke={`${D.amber}60`} strokeWidth="0.7"/>
          </svg>
        </div>
      )}
      <div style={{display:"flex",gap:"10px",flexWrap:"wrap",marginTop:"10px",justifyContent:"center"}}>
        {[{c:LK_COLS["6"],l:"6"},{c:LK_COLS["4"],l:"4"},{c:LK_COLS["1-3"],l:"1–3"},{c:LK_COLS["0"],l:"Dot"},{c:LK_COLS.W,l:"Wicket"}].map(({c,l})=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:"4px"}}>
            <div style={{width:"10px",height:"2px",background:c,borderRadius:"1px"}}/>
            <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{l}</span>
          </div>
        ))}
      </div>
      {/* The provenance line. A wheel that mixes measured points with
          sector-era bands, or that is missing half the innings, says so here
          rather than looking complete. */}
      {(drawn.length>0)&&(
        <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"8px",textAlign:"center",lineHeight:1.5}}>
          {exact===drawn.length
            ?"Every shot placed exactly."
            :exact===0
              ?"Sector-era: direction recorded, distance never was — dashed."
              :`${exact} of ${drawn.length} placed exactly; the dashed spokes carry direction only.`}
          {missing>0&&` ${missing} ball${missing===1?"":"s"} carried no placement.`}
        </div>
      )}
    </Card>
  );
}

/* ──────────────────────────────
   WHERE HE MAKES CONTACT — the surface (SCRBRD-046)
   and the shape (SCRBRD-045). Both derive from the same captured points the
   wheel draws, in the same frame, with the same mirror; see
   packages/scoring/src/spatial.mjs for what each figure is and is not.
────────────────────────────── */
/** The balls a chart is about, and the hand each was played with. */
const shotsOf=(inn,playerId)=>{
  const log=inn?.ballLog||[];
  return playerId?log.filter(b=>b.strikerId===playerId):log;
};
const handFor=(inn)=>(b)=>batHandOf(inn,b.strikerId);
/**
 * The balls a chart could not draw, read against what their innings DECLARED
 * it would capture (SCRBRD-039). A ball carries its own innings' declaration
 * when it came from a career read (lib/live.js asShotPoint); inside one
 * innings it is the innings' own. Undeclared reads exactly as it always did.
 */
const pointEvidence=(inn,balls)=>placementEvidence(balls,{
  need:PLACEMENT_FIELD.POINT,
  declaredFor:b=>b.declaredProfile!==undefined?b.declaredProfile:(inn?.declaredProfile??null),
});
const PROFILE_WORD={full:"full",standard:"standard (sector only)",quick:"quick (runs only)"};
const declaredOf=(inn,balls)=>{
  const ps=new Set(balls.map(b=>b.declaredProfile!==undefined?b.declaredProfile:(inn?.declaredProfile??null)).filter(Boolean));
  return ps.size===1?[...ps][0]:null;
};
/** One line under a chart saying what it drew and what it left out — and
 *  which of the gaps are gaps, and which were never asked for. */
const Provenance=({n,missing,notCaptured=0,children})=>(
  <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"8px",textAlign:"center",lineHeight:1.5}}>
    {children??`${n} shot${n===1?"":"s"} placed exactly.`}
    {missing>0&&` ${missing} ball${missing===1?"":"s"} carried no exact point and ${missing===1?"is":"are"} not drawn.`}
    {notCaptured>0&&<span data-testid="placement-not-captured-count">{` ${notCaptured} came from an innings that never asked for an exact point.`}</span>}
  </div>
);
const NothingHere=({mine,ev,declared})=>(
  <div style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px",padding:"18px 0",textAlign:"center"}}
    data-testid={ev?.label===NOT_CAPTURED?"placement-not-captured":undefined}>
    {!mine.length?"No balls faced."
      :ev?.label===NOT_CAPTURED
        ?`Not captured, by design: ${declared?`this innings was declared ${PROFILE_WORD[declared]??declared}`:"these innings were declared"} and never asked for an exact point.`
        :"No exact placements on record."}
  </div>
);

function ShotHeatMap({inn,playerId=null,title="Where he makes contact"}){
  if(!inn)return null;
  const mine=shotsOf(inn,playerId);
  const d=shotDensity(mine,{batHandFor:handFor(inn)});
  const ev=pointEvidence(inn,mine);
  // One hue, light to dark: a sequential surface is magnitude, and magnitude
  // is a single ramp. The amber is the ground's own colour on the wheel.
  const cells=d.cells.filter(c=>c.density>=0.04);
  return (
    <div data-testid="shot-heat-map">
    <Card style={{padding:"14px 16px"}}>
      <div style={{display:"flex",alignItems:"baseline",gap:"8px",marginBottom:"10px"}}>
        <Lbl>{title}</Lbl>
        <span style={{marginLeft:"auto",fontFamily:D.mono,fontSize:"11px",color:D.textSecondary}}>{d.n} placed</span>
      </div>
      {d.n===0?<NothingHere mine={mine} ev={ev} declared={declaredOf(inn,mine)}/>:(
        <div style={{width:"100%",maxWidth:"260px",margin:"0 auto",aspectRatio:"1"}}>
          <svg viewBox="0 0 300 300" style={{width:"100%",height:"100%",display:"block"}} role="img"
            aria-label={`Contact density: ${d.n} placed shots, bandwidth ${d.bandwidth}`}>
            <defs><clipPath id={`heat-clip-${playerId??"all"}`}><circle cx={CX} cy={CY} r={R_BND}/></clipPath></defs>
            <circle cx={CX} cy={CY} r={R_BND+3} fill={T.field.ground} stroke={`${D.amber}30`} strokeWidth="1"/>
            <g clipPath={`url(#heat-clip-${playerId??"all"})`}>
              {cells.map((c,i)=>{
                const px=CX+(c.x-c.size/2)*R_BND, py=CY+(c.y-c.size/2)*R_BND, w=c.size*R_BND;
                return(<rect key={i} className="heat-cell" x={px} y={py} width={w+0.4} height={w+0.4}
                  fill={D.amber} opacity={Math.min(1,c.density).toFixed(3)} data-density={c.density.toFixed(3)}>
                  <title>{`${Math.round(c.density*100)}% of the peak`}</title>
                </rect>);
              })}
            </g>
            <circle cx={CX} cy={CY} r={R_MID} fill="none" stroke={T.field.rule} strokeWidth="1" strokeDasharray="4 3"/>
            <circle cx={CX} cy={CY} r={R_IN} fill="none" stroke={T.field.rule} strokeWidth="1" strokeDasharray="3 4"/>
            <rect x={CX-4.5} y={CY-R_PITCH} width={9} height={R_PITCH*2} rx="2.5" fill={T.field.pitch} stroke={`${D.amber}60`} strokeWidth="0.7"/>
          </svg>
        </div>
      )}
      {d.n>0&&<Provenance n={d.n} missing={ev.missing} notCaptured={ev.notCaptured}/>}
    </Card>
    </div>
  );
}

function ShotSpider({inn,playerId=null,title="Reach by direction"}){
  if(!inn)return null;
  const mine=shotsOf(inn,playerId);
  const p=directionalProfile(mine);
  const ev=pointEvidence(inn,mine);
  // The axes are mirrored for a left-hander, the bins are not: his cover is
  // still his cover, it is just on the other side of the ground. A whole
  // innings of mixed hands is drawn in the right-hander's frame and says so.
  const hands=new Set(mine.filter(hasPoint).map(b=>batHandOf(inn,b.strikerId)));
  const hand=playerId?batHandOf(inn,playerId):(hands.size===1?[...hands][0]:"R");
  const at=(mid,r)=>toXY(screenAngle(mid,hand),r);
  const pts=p.directions.map(d=>at(d.mid,(d.reach??0)*R_BND));
  return (
    <div data-testid="shot-spider">
    <Card style={{padding:"14px 16px"}}>
      <div style={{display:"flex",alignItems:"baseline",gap:"8px",marginBottom:"10px"}}>
        <Lbl>{title}</Lbl>
        <span style={{marginLeft:"auto",fontFamily:D.mono,fontSize:"11px",color:D.textSecondary}}>{p.n} placed</span>
      </div>
      {p.n===0?<NothingHere mine={mine} ev={ev} declared={declaredOf(inn,mine)}/>:(
        <div style={{width:"100%",maxWidth:"280px",margin:"0 auto",aspectRatio:"1"}}>
          <svg viewBox="0 0 300 300" style={{width:"100%",height:"100%",display:"block"}} role="img"
            aria-label={`Reach by direction: ${p.n} placed shots, strongest ${p.strongest?.replace(/_/g," ")}`}>
            <circle cx={CX} cy={CY} r={R_BND} fill={T.field.ground} stroke={`${D.amber}30`} strokeWidth="1"/>
            <circle cx={CX} cy={CY} r={R_MID} fill="none" stroke={T.field.rule} strokeWidth="1" strokeDasharray="4 3"/>
            <circle cx={CX} cy={CY} r={R_IN} fill="none" stroke={T.field.rule} strokeWidth="1" strokeDasharray="3 4"/>
            {p.directions.map(d=>{const[x,y]=at(d.mid,R_BND);return(
              <line key={`a${d.key}`} x1={CX} y1={CY} x2={x} y2={y} stroke={T.field.hairline} strokeWidth="0.6"/>);})}
            <polygon className="spider-shape" points={pts.map(q=>q.join(",")).join(" ")}
              fill={`${D.indigo}30`} stroke={D.indigo} strokeWidth="1.5" strokeLinejoin="round"/>
            {p.directions.map((d,i)=>{
              const[x,y]=pts[i];const[lx,ly]=at(d.mid,R_BND+15);
              return(<g key={d.key} data-testid={`spider-axis-${d.key}`} data-shots={d.shots} data-reach={d.reach==null?"":d.reach.toFixed(2)} data-x={lx.toFixed(1)}>
                {d.shots>0&&<circle cx={x} cy={y} r="3.5" fill={D.indigo} stroke={T.field.ground} strokeWidth="1.5">
                  <title>{`${d.label}: ${d.shots} shot${d.shots===1?"":"s"}, reach ${Math.round(d.reach*100)}% of the rope, ${d.runs} run${d.runs===1?"":"s"}`}</title>
                </circle>}
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="7" fontFamily={D.body}
                  fill={d.shots?D.textSecondary:D.textMuted} fontWeight={d.key===p.strongest?700:400}>
                  {d.label}{d.shots?` ${d.shots}`:""}
                </text>
              </g>);
            })}
            <rect x={CX-4.5} y={CY-R_PITCH} width={9} height={R_PITCH*2} rx="2.5" fill={T.field.pitch} stroke={`${D.amber}60`} strokeWidth="0.7"/>
          </svg>
        </div>
      )}
      {p.n>0&&(
        <Provenance n={p.n} missing={ev.missing} notCaptured={ev.notCaptured}>
          {`Reach is the mean distance in each direction, 100% at the rope; the number is shots that way. `}
          {!playerId&&hands.size>1?"Mixed hands, drawn as a right-hander's ground. ":""}
          {`${p.n} shot${p.n===1?"":"s"} placed exactly.`}
        </Provenance>
      )}
    </Card>
    </div>
  );
}

function AnalysisDashboard({inn,match,curIn,innings}){
  const overs=match?.overs||20;
  const target=curIn===1?(innings[0]?.runs||0)+1:null;
  const isChase=curIn===1;
  const sig=buildSignals(inn,overs,target,isChase);
  const[activeView,setActiveView]=useState("charts");
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      {/* Sub-nav */}
      <div style={{display:"flex",gap:"6px"}}>
        {[["charts","📊 Charts"],["signals","📡 Signals"],["intelligence","🧠 Intelligence"]].map(([id,label])=>(
          <button key={id} onClick={()=>setActiveView(id)} className="pressBtn" style={{
            padding:"7px 16px",borderRadius:D.pill,cursor:"pointer",border:"none",
            fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",
            background:activeView===id?D.grad:T.fill.field,
            color:activeView===id?T.light.ink:D.textMuted,
            boxShadow:activeView===id?"0 4px 16px "+D.indigo+"40":"none",
            transition:"all .2s"}}>
            {label}
          </button>
        ))}
      </div>
      {activeView==="charts"&&(
        <div className="sc-grid-2">
          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
            <WormChart innings={innings} curIn={curIn} match={match}/>
            <RunRateChart inn={inn} match={match} target={target}/>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
            <ManhattanChart inn={inn} match={match}/>
            <BatsmanChart inn={inn}/>
            <BowlerChart inn={inn}/>
            <ShotHeatMap inn={inn}/>
            <ShotSpider inn={inn}/>
          </div>
        </div>
      )}
      {activeView==="signals"&&(
        <div className="sc-grid-2">
          {sig&&(
            <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
              <Card style={{padding:"18px"}}>
                <Lbl sx={{marginBottom:"14px"}}>Signal Dashboard</Lbl>
                <div style={{display:"flex",flexDirection:"column",gap:"13px"}}>
                  <SignalBar label="Pressure" value={sig.pressure+"%"} pct={sig.pressure} color={sig.pressureColor}/>
                  <SignalBar label="Momentum" value={sig.momLabel} pct={50+sig.mom/2} color={sig.momColor} center/>
                  <SignalBar label="Run Rate" value={sig.rr} pct={Math.min(100,sig.rr/18*100)} color={D.sky}/>
                  <SignalBar label="Dots / 6" value={sig.dotsL6} pct={sig.dotsL6/6*100} color={sig.dotsL6>=4?D.rose:D.textSecondary}/>
                  <SignalBar label="Bnds / 12" value={sig.bndsL12} pct={sig.bndsL12/6*100} color={D.amber}/>
                  <SignalBar label="Wkts / 12" value={sig.wktsL12} pct={sig.wktsL12/3*100} color={sig.wktsL12>=2?D.rose:D.textSecondary}/>
                </div>
              </Card>
              {sig.flags.length>0&&(
                <Card style={{padding:"16px"}}>
                  <Lbl sx={{marginBottom:"10px"}}>Active Flags</Lbl>
                  <div style={{display:"flex",flexWrap:"wrap",gap:"7px"}}>
                    {sig.flags.map(f=>(
                      <Badge key={f} color={f.includes("ON_TRACK")||f.includes("STABIL")?D.emerald:f.includes("BEHIND")||f.includes("RISK")||f.includes("HAT")?D.rose:D.amber}>
                        {f.replace(/_/g," ")}
                      </Badge>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            <BatsmanChart inn={inn}/>
            <BowlerChart inn={inn}/>
          </div>
        </div>
      )}
      {activeView==="intelligence"&&(
        <div className="sc-grid-2">
          <IntelPanel inn={inn} overs={overs} target={target} isChase={isChase}/>
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            <BatsmanChart inn={inn}/>
            <BowlerChart inn={inn}/>
          </div>
        </div>
      )}
    </div>
  );
}

export { AnalysisDashboard, BatsmanChart, BowlerChart, ManhattanChart, RunRateChart, ShotHeatMap, ShotSpider, ShotWheel, WormChart };
