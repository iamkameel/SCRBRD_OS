import { useState } from "react";
import { D } from "../design/tokens.js";
import { RR, SR } from "./format.js";
import { IntelPanel } from "./panels.jsx";
import { buildSignals } from "./signals.js";
import { Badge, Card, Lbl, SignalBar } from "./ui.jsx";

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
        wkts.push({ball,runs,n:wkts.length+1,name:bat?bat.name:(b.dismissal||"Wicket"),mode:b.dismissal||""});
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
              <span style={{fontFamily:D.mono,fontSize:"12px",color:b.wickets>0?D.rose:D.textSecondary,fontWeight:b.wickets?"600":"400"}}>{b.wickets+"W-"+b.runs+"R"}</span>
              <Badge color={econCol} sx={{fontSize:"9px"}}>{econ}</Badge>
            </div>
          );
        })}
      </div>
    </Card>
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
            background:activeView===id?D.grad:"rgba(255,255,255,0.05)",
            color:activeView===id?"#fff":D.textMuted,
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

export { AnalysisDashboard, BatsmanChart, BowlerChart, ManhattanChart, RunRateChart, WormChart };
