import { useState, Fragment } from "react";
import { D, textOn } from "../design/tokens.js";
import { BatsmanChart, BowlerChart, ManhattanChart, RunRateChart, WormChart } from "./charts.jsx";
import { SEGS } from "./field.js";
import { RR, SR, fmtOv } from "./format.js";
import { batHandOf, positionName } from "@scrbrd/scoring";
import { CommentaryCard, WagonWheel } from "./panels.jsx";
import { seedCompletedMatch } from "./seed.js";
import { ALL_SHOTS_FLAT, SHOT_CATS } from "./shots.js";
import { getPhase } from "./signals.js";
import { Badge, BallDot, Btn, Card, Glass, Lbl } from "./ui.jsx";
import { Select } from "../ui/primitives.jsx";

/* ═══════════════════════════════════════════════════════
   SCORING HUB  — 3-stage inline card
   stage 0: Shot picker (icon grid + approach + extras)
   stage 1: Wagon wheel field placement
   stage 2: Run selector + Wicket
═══════════════════════════════════════════════════════ */
function ScoringHub({inn,innings,curIn,match,hubStage,hubShot,hubApproach,selSeg,
  fieldView,setFieldView,hidden,toggleLine,setModal,
  onApproach,onShot,onShotSkip,onFieldSel,onRun,onBye,onLegBye,onWicket,onWide,onNoBall,onReset,onBack}){
  // Placement is stored batter-relative, so the mirror is applied at capture
  // and at render — never to the stored value. This is what makes a
  // left-hander's cover drive comparable with a right-hander's.
  const batHand=batHandOf(inn);
  const shotInfo=hubShot?ALL_SHOTS_FLAT.find(s=>s.id===hubShot):null;
  const segInfo=selSeg!=null?SEGS[selSeg.seg]:null;
  const STAGE_LABELS=["Shot","Field","Runs"];
  return (
    <Card style={{overflow:"hidden"}}>
      {/* Stage breadcrumb header */}
      <div style={{padding:"10px 14px",borderBottom:"1px solid "+D.border,
        display:"flex",alignItems:"center",gap:"5px",flexWrap:"wrap"}}>
        <Lbl sx={{marginRight:"4px",flexShrink:0}}>Scoring Hub</Lbl>
        {STAGE_LABELS.map((s,i)=>(
          <Fragment key={s}>
            <div style={{
              padding:"2px 9px",borderRadius:D.pill,
              fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",
              background:i===hubStage?D.grad:i<hubStage?D.emerald+"18":"transparent",
              color:i===hubStage?"#fff":i<hubStage?D.emerald:D.textMuted,
              border:"1px solid "+(i===hubStage?D.indigo+"55":i<hubStage?D.emerald+"33":D.border),
              transition:"all .25s",
            }}>{i<hubStage?"✓ ":""}{s}</div>
            {i<2&&<div style={{width:"5px",height:"1px",background:D.border}}/>}
          </Fragment>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:"6px"}}>
          {hubStage>0&&(
            <button onClick={onBack} className="pressBtn" style={{
              padding:"3px 11px",borderRadius:D.pill,border:"1px solid "+D.border,
              background:"transparent",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>
              ← Back
            </button>
          )}
          {hubStage>0&&(
            <button onClick={onReset} className="pressBtn" style={{
              padding:"3px 10px",borderRadius:D.pill,border:"1px solid "+D.border,
              background:"transparent",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* STAGE 0: Approach toggle + Shot icon grid */}
      {hubStage===0&&(
        <div style={{padding:"12px 14px"}}>
          {/* Approach selector — required before shot selection */}
          <div style={{marginBottom:"14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"8px"}}>
              <Lbl>Bowler Approach</Lbl>
              {!hubApproach&&<span style={{fontFamily:D.body,fontSize:"10px",color:D.roseText,fontWeight:500}}>⚠ Required</span>}
              {hubApproach&&<span style={{fontFamily:D.body,fontSize:"10px",color:D.emerald,fontWeight:500}}>✓ Set</span>}
              <div style={{marginLeft:"auto",display:"flex",gap:"5px"}}>
                <button onClick={onWide} className="pressBtn" style={{
                  padding:"4px 10px",borderRadius:D.pill,border:"1px solid "+D.orange+"44",
                  background:D.orange+"10",color:D.orange,cursor:"pointer",
                  fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.05em"}}>WIDE</button>
                <button onClick={onNoBall} className="pressBtn" style={{
                  padding:"4px 10px",borderRadius:D.pill,border:"1px solid "+D.amber+"44",
                  background:D.amber+"10",color:D.amber,cursor:"pointer",
                  fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.05em"}}>NO BALL</button>
              </div>
            </div>
            {/* Toggle switch */}
            <div style={{display:"flex",background:D.surf2,borderRadius:D.pill,padding:"3px",border:"1px solid "+D.border,position:"relative"}}>
              {["Over the wicket","Around the wicket"].map((a,i)=>{
                const isActive=hubApproach===a;
                return (
                  <button key={a} onClick={()=>onApproach(a)} className="pressBtn" style={{
                    flex:1,padding:"8px 12px",borderRadius:D.pill,cursor:"pointer",border:"none",
                    fontFamily:D.body,fontSize:"12px",fontWeight:isActive?600:400,
                    background:isActive?"linear-gradient(135deg,"+D.indigo+","+D.sky+")"  :"transparent",
                    color:isActive?"#fff":D.textMuted,
                    transition:"all .2s cubic-bezier(.34,1.56,.64,1)",
                    boxShadow:isActive?"0 2px 12px "+D.indigo+"40":"none",
                  }}>
                    {i===0?"🔄 Over the Wicket":"↩️ Around the Wicket"}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Shot grid — locked until approach selected */}
          {!hubApproach&&(
            <div style={{padding:"20px",textAlign:"center",borderRadius:D.md,border:"1px dashed "+D.border,
              background:D.surf2+"88",marginBottom:"10px"}}>
              <div style={{fontSize:"24px",marginBottom:"8px"}}>🏏</div>
              <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted}}>Select approach above to enable shot selection</div>
            </div>
          )}
          {hubApproach&&SHOT_CATS.map(cat=>(
            <div key={cat.cat} style={{marginBottom:"10px"}}>
              <Lbl sx={{marginBottom:"6px",color:cat.color}}>{cat.cat}</Lbl>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"5px"}}>
                {cat.shots.map(shot=>(
                  <button key={shot.id} onClick={()=>onShot(shot.id)} className="pressBtn" style={{
                    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                    gap:"3px",padding:"9px 4px",borderRadius:D.md,cursor:"pointer",
                    border:"1px solid "+D.border,background:D.surf2,transition:"all .15s"}}>
                    <span style={{fontSize:"18px",lineHeight:1}}>{shot.icon}</span>
                    <span style={{fontFamily:D.body,fontSize:"9px",fontWeight:500,
                      color:D.textSecondary,textAlign:"center",lineHeight:1.2}}>{shot.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {hubApproach&&<button onClick={onShotSkip} className="pressBtn" style={{
            width:"100%",padding:"8px",borderRadius:D.md,border:"1px solid "+D.border,
            background:"transparent",cursor:"pointer",color:D.textMuted,
            fontFamily:D.body,fontSize:"11px",marginTop:"4px"}}>Skip shot →</button>}
        </div>
      )}

      {/* STAGE 1: Wagon wheel field placement */}
      {hubStage===1&&(
        <div style={{padding:"12px 14px"}}>
          <div style={{display:"flex",gap:"7px",marginBottom:"10px",flexWrap:"wrap",alignItems:"center"}}>
            {shotInfo&&(
              <div style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 10px",
                borderRadius:D.md,background:shotInfo.color+"12",border:"1px solid "+shotInfo.color+"25"}}>
                <span style={{fontSize:"14px"}}>{shotInfo.icon}</span>
                <span style={{fontFamily:D.body,fontSize:"11px",color:textOn(shotInfo.color)}}>{shotInfo.label}</span>
              </div>
            )}
            {!shotInfo&&<span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>No shot</span>}
            {hubApproach&&<Badge color={D.amber} sx={{fontSize:"8px"}}>{hubApproach==="Around the wicket"?"Around":"Over"}</Badge>}
            {/* The derived name, echoed back on tap. The sector model gave
                the scorer this reassurance for free — you pressed a wedge
                labelled "Cover" — and point capture has to keep it, or the
                interface feels like it lost something in exchange for
                precision nobody can see. */}
            <span style={{fontFamily:D.body,fontSize:"11px",color:selSeg?D.emerald:D.amber,fontWeight:500,marginLeft:"auto"}}>
              {selSeg?.theta!=null
                ? `📍 ${positionName(selSeg.theta,selSeg.radius) ?? "placed"}`
                : "📍 Tap where it went"}
            </span>
          </div>
          <WagonWheel
            ballLog={inn?.ballLog||[]}
            selSeg={selSeg}
            batHand={batHand}
            // Point capture: the tap IS the placement. The sector guides stay
            // drawn as scaffolding but are no longer targets — see §7 of the
            // point-capture spec, and placement.mjs for why snapping would
            // defeat the whole change.
            onPlace={p=>onFieldSel(p)}
            viewMode={fieldView}
            onViewMode={setFieldView}
            hidden={hidden}
            onToggle={toggleLine}/>
        </div>
      )}

      {/* STAGE 2: Run selector */}
      {hubStage===2&&(
        <div style={{padding:"12px 14px"}}>
          <div style={{display:"flex",gap:"6px",marginBottom:"12px",flexWrap:"wrap",alignItems:"center"}}>
            {shotInfo&&(
              <div style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 10px",
                borderRadius:D.md,background:shotInfo.color+"12",border:"1px solid "+shotInfo.color+"25"}}>
                <span style={{fontSize:"13px"}}>{shotInfo.icon}</span>
                <span style={{fontFamily:D.body,fontSize:"11px",color:textOn(shotInfo.color)}}>{shotInfo.label}</span>
              </div>
            )}
            {segInfo&&(
              <div style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 10px",
                borderRadius:D.md,background:D.indigo+"10",border:"1px solid "+D.indigo+"22"}}>
                <span style={{fontSize:"11px"}}>📍</span>
                <span style={{fontFamily:D.body,fontSize:"11px",color:D.sky}}>
                  {segInfo.label+(selSeg?.zone==="boundary"?" · Boundary":selSeg?.zone==="outer"?" · Outfield":"")}
                </span>
              </div>
            )}
            {hubApproach&&<Badge color={D.amber} sx={{fontSize:"8px"}}>{hubApproach==="Around the wicket"?"Around":"Over"}</Badge>}
          </div>
          <Lbl sx={{marginBottom:"8px"}}>Runs Scored</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"5px",marginBottom:"9px"}}>
            {[0,1,2,3,4,5,6].map(r=>(
              <button key={r} onClick={()=>onRun(r)} className="pressBtn" style={{
                padding:"15px 0",borderRadius:D.md,cursor:"pointer",
                fontFamily:D.mono,fontSize:r===6?"20px":"16px",fontWeight:500,
                border:"1px solid "+(r===4?D.indigo+"55":r===6?D.amber+"55":D.border),
                background:r===4?D.indigo+"18":r===6?D.amber+"18":D.surf2,
                color:r===4?D.sky:r===6?D.amber:D.textPrimary,
                transition:"all .12s",
                boxShadow:r===4?"0 0 12px "+D.indigo+"15":r===6?"0 0 12px "+D.amber+"15":"none",
              }}>{r}</button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px",marginBottom:"9px"}}>
            {[["Bye","B"],["Leg Bye","LB"]].map(([l,t])=>(
              <button key={t} onClick={()=>t==="B"?onBye():onLegBye()} className="pressBtn" style={{
                padding:"9px",borderRadius:D.md,cursor:"pointer",
                border:"1px solid "+D.violet+"33",background:D.violet+"08",
                color:D.violetText,fontFamily:D.head,fontSize:"10px",fontWeight:700,
                letterSpacing:"0.05em",textTransform:"uppercase"}}>{l}</button>
            ))}
          </div>
          <button onClick={onWicket} className="pressBtn" style={{
            width:"100%",padding:"13px",borderRadius:D.md,cursor:"pointer",
            border:"1px solid "+D.rose+"44",background:D.rose+"0e",
            color:D.roseText,fontFamily:D.head,fontSize:"13px",fontWeight:700,
            letterSpacing:"0.06em",textTransform:"uppercase",
            boxShadow:"0 4px 20px "+D.rose+"15",transition:"all .15s"}}>
            ⚡ Wicket
          </button>
        </div>
      )}

      {/* Quick utilities — always visible */}
      <div style={{padding:"10px 14px",borderTop:"1px solid "+D.border,display:"flex",flexDirection:"column",gap:"6px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"6px"}}>
          <Btn variant="ghost" size="sm" sx={{borderRadius:D.md}} onClick={()=>setModal("newOver")}>Chg Bowler</Btn>
          <Btn variant="ghost" size="sm" sx={{borderRadius:D.md}} onClick={()=>setModal("penalty")}>Penalty</Btn>
          <Btn variant="ghost" size="sm" sx={{borderRadius:D.md}} onClick={()=>setModal("editOrder")}>Bat Order</Btn>
        </div>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════
   SCORING PANEL  (assembles hero, batsmen, bowler, hub, commentary)
═══════════════════════════════════════════════════════ */
function ScoringPanel({inn,innings,curIn,match,hubStage,hubShot,hubApproach,selSeg,
  freeHit,fieldView,setFieldView,hidden,toggleLine,setModal,scoreKey,
  onApproach,onShot,onShotSkip,onFieldSel,onRun,onBye,onLegBye,onWicket,onWide,onNoBall,onReset,onBack,onUndo}){
  const bat1=inn?.batsmen.find(b=>b.id===inn.striker);
  const bat2=inn?.batsmen.find(b=>b.id===inn.nonStriker);
  const bow=inn?.bowlers.find(b=>b.id===inn.bowler);
  const overBalls=(()=>{
    if(!inn)return[];
    const ov=Math.floor(inn.balls/6);
    return inn.overLog.find(o=>o.over===ov)?.balls||[];
  })();
  const target=curIn===1?(innings[0]?.runs||0)+1:null;
  const maxBalls=(match?.overs||20)*6;
  const phase=inn?getPhase(inn.balls,match?.overs||20):"POWERPLAY";
  const phaseCol=phase==="POWERPLAY"?D.emerald:phase==="MIDDLE"?D.amber:D.orange;
  const rrr=target&&inn?.balls<maxBalls?((target-(inn?.runs||0))/((maxBalls-(inn?.balls||0))/6)).toFixed(2):"—";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      <Glass glow={D.indigo} style={{padding:0}}>
        <div className="gradAnim" style={{height:"3px",background:"linear-gradient(90deg,"+D.indigo+","+D.sky+","+D.emerald+","+D.indigo+")",backgroundSize:"200% 100%"}}/>
        <div style={{padding:"16px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              <div className="liveDot liveGlow" style={{width:"8px",height:"8px",borderRadius:"50%",background:D.emerald}}/>
              <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.emerald,letterSpacing:"0.18em",textTransform:"uppercase"}}>LIVE</span>
              <Badge color={phaseCol}>{phase}</Badge>
              <Badge color={D.sky}>{"Inn "+(curIn+1)}</Badge>
            </div>
            <Badge color={D.textMuted}>{(match?.overs||20)+" ov"}</Badge>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:"12px"}}>
            <div style={{flex:1}}>
              <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"2px"}}>{inn?.battingTeam}</div>
              <div key={scoreKey} className="scoreAnim" style={{fontFamily:D.mono,fontSize:"clamp(42px,5vw,54px)",fontWeight:500,color:D.textPrimary,lineHeight:1,letterSpacing:"-0.025em"}}>
                {inn?.runs||0}<span style={{color:D.textMuted,fontSize:"clamp(28px,3.5vw,36px)",fontWeight:400}}>{"/"+(inn?.wickets||0)}</span>
              </div>
              <div style={{marginTop:"6px",display:"flex",gap:"7px",alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>{fmtOv(inn?.balls||0)} ov</span>
                <span style={{width:"1px",height:"10px",background:D.border,flexShrink:0}}/>
                <div style={{display:"flex",alignItems:"baseline",gap:"3px"}}>
                  <span style={{fontFamily:D.mono,fontSize:"15px",fontWeight:500,color:D.sky,lineHeight:1}}>{RR(inn?.runs||0,inn?.balls||0)}</span>
                  <span style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted}}>RR</span>
                </div>
                {freeHit&&<span style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.08em",
                  color:"#fff",background:"linear-gradient(135deg,#f97316,#f59e0b)",
                  padding:"2px 8px",borderRadius:D.pill}}>⚡ FREE HIT</span>}
              </div>
            </div>
            {target&&(
              <div style={{background:D.surf2,border:"1px solid "+D.border,borderRadius:D.lg,padding:"9px 13px",textAlign:"right",flexShrink:0}}>
                <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"2px"}}>Target</div>
                <div style={{fontFamily:D.mono,fontSize:"24px",fontWeight:500,background:D.grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",lineHeight:1}}>{target}</div>
                <div style={{color:D.orange,fontSize:"10px",fontFamily:D.body,marginTop:"3px"}}>{"Need "+Math.max(0,target-(inn?.runs||0))+" off "+(maxBalls-(inn?.balls||0))+"b"}</div>
                <div style={{color:D.textMuted,fontSize:"10px",fontFamily:D.mono,marginTop:"1px"}}>{"RRR "+rrr}</div>
              </div>
            )}
          </div>
          <div style={{marginTop:"12px",paddingTop:"10px",borderTop:"1px solid "+D.border}}>
            <div style={{display:"flex",alignItems:"center",gap:"7px",flexWrap:"wrap"}}>
              <Lbl>This over</Lbl>
              {overBalls.length===0
                ?<span style={{color:D.textMuted,fontSize:"10px",fontFamily:D.body,fontStyle:"italic"}}>new over</span>
                :overBalls.map((b,i)=>(<BallDot key={i} ball={b} size={24}/>))
              }
              {overBalls.length>0&&<span style={{color:D.textSecondary,fontSize:"10px",fontFamily:D.mono,marginLeft:"auto"}}>{overBalls.reduce((s,b)=>s+(b.value||0),0)+" runs"}</span>}
            </div>
          </div>
        </div>
      </Glass>
      <Card accent={D.emerald}>
        <div style={{padding:"8px 13px 5px",display:"grid",gridTemplateColumns:"1fr 28px 28px 22px 22px 38px",gap:"3px",borderBottom:"1px solid "+D.border}}>
          {["Batsman","R","B","4s","6s","SR"].map(h=>(<Lbl key={h} sx={{textAlign:h==="Batsman"?"left":"right"}}>{h}</Lbl>))}
        </div>
        {[bat1,bat2].filter(Boolean).map((b,i)=>(
          <div key={b.id} style={{padding:"7px 13px",display:"grid",gridTemplateColumns:"1fr 28px 28px 22px 22px 38px",gap:"3px",
            background:i%2?D.surf2+"44":"transparent",borderBottom:"1px solid "+D.border,alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
              {b.id===inn?.striker
                ?<div className="liveDot" style={{width:"5px",height:"5px",borderRadius:"50%",background:D.emerald,flexShrink:0}}/>
                :<div style={{width:"5px",height:"5px",flexShrink:0}}/>}
              <span style={{color:D.textPrimary,fontSize:"13px",fontFamily:D.body,fontWeight:500}}>{b.name}</span>
            </div>
            {[b.runs,b.balls,b.fours,b.sixes,SR(b.runs,b.balls)].map((v,j)=>(
              <div key={j} style={{textAlign:"right",fontFamily:D.mono,fontSize:"12px",
                fontWeight:j===0?"500":"400",
                color:j===0?D.textPrimary:j===2?D.indigo:j===3?D.amber:j===4?D.textMuted:D.textSecondary}}>{v}</div>
            ))}
          </div>
        ))}
        {!bat1&&(
          <button onClick={()=>setModal("opener")} style={{width:"100%",padding:"10px",background:"transparent",
            border:"none",color:D.textMuted,cursor:"pointer",fontFamily:D.body,fontSize:"13px"}}>
            + Set opening pair
          </button>
        )}
      </Card>
      {bow&&(
        <Card accent={D.orange}>
          <div style={{padding:"8px 13px 5px",display:"grid",gridTemplateColumns:"1fr 34px 20px 28px 22px 38px",gap:"3px",borderBottom:"1px solid "+D.border}}>
            {["Bowler","O","M","R","W","Econ"].map(h=>(<Lbl key={h} sx={{textAlign:h==="Bowler"?"left":"right"}}>{h}</Lbl>))}
          </div>
          <div style={{padding:"7px 13px",display:"grid",gridTemplateColumns:"1fr 34px 20px 28px 22px 38px",gap:"3px",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
              <span style={{color:D.orange,fontSize:"12px"}}>⚡</span>
              <span style={{color:D.textPrimary,fontSize:"13px",fontFamily:D.body,fontWeight:500}}>{bow.name}</span>
              {bow.bowlArm&&<span style={{fontFamily:D.mono,fontSize:"8px",fontWeight:700,padding:"1px 4px",borderRadius:D.pill,
                background:`${D.violet}15`,border:`1px solid ${D.violet}33`,color:D.violetText,flexShrink:0}}>
                {bow.bowlArm==="L"?"LA":"RA"}{bow.bowlStyle==="S"?"S":bow.bowlStyle==="M"?"M":"F"}
              </span>}
            </div>
            {[fmtOv(bow.balls),bow.maidens,bow.runs,bow.wickets,RR(bow.runs,bow.balls)].map((v,i)=>(
              <div key={i} style={{textAlign:"right",fontFamily:D.mono,fontSize:"12px",
                fontWeight:i===3?"500":"400",color:i===3?D.rose:D.textPrimary}}>{v}</div>
            ))}
          </div>
        </Card>
      )}
      <ScoringHub
        inn={inn} innings={innings} curIn={curIn} match={match}
        hubStage={hubStage} hubShot={hubShot} hubApproach={hubApproach}
        selSeg={selSeg}
        fieldView={fieldView} setFieldView={setFieldView}
        hidden={hidden} toggleLine={toggleLine}
        setModal={setModal}
        onApproach={onApproach} onShot={onShot} onShotSkip={onShotSkip}
        onFieldSel={onFieldSel} onRun={onRun} onBye={onBye} onLegBye={onLegBye}
        onWicket={onWicket} onWide={onWide} onNoBall={onNoBall} onReset={onReset}
        onBack={onBack}/>
      <CommentaryCard inn={inn}/>
      {/* Undo last ball */}
      {inn?.ballLog?.length>0&&onUndo&&(
        <button onClick={onUndo} className="pressBtn" style={{
          display:"flex",alignItems:"center",justifyContent:"center",gap:"7px",
          width:"100%",padding:"10px",borderRadius:D.md,cursor:"pointer",
          border:"1px solid "+D.border,background:"transparent",
          color:D.textMuted,fontFamily:D.body,fontSize:"12px",
          animation:"undoPop .3s cubic-bezier(.22,1,.36,1)",
          transition:"all .15s",
        }}>
          <span style={{fontSize:"14px"}}>↩</span>
          <span>Undo last ball</span>
          <span style={{fontFamily:D.mono,fontSize:"10px",opacity:.5,marginLeft:"auto"}}>
            {inn.ballLog.length} ball{inn.ballLog.length!==1?"s":""}
          </span>
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   FOCUS PAD — distraction-free one-tap scoring surface.
   Rich shot/field capture lives one toggle away in Pro mode.
═══════════════════════════════════════════════════════ */
function FocusPad({inn,match,curIn,target,onCommitDetailed,onWicketCtx,onWide,onNoBall,onUndo,onPro,quick,onToggleQuick}){
  const [phase,setPhase]=useState(1);      // 1 Shot · 2 Area · 3 Outcome
  const [shot,setShot]=useState(null);
  const [area,setArea]=useState(null);     // {seg,zone} | null (didn't travel)
  const [wagonView,setWagonView]=useState("wagon");
  const [hidden]=useState(()=>new Set());
  if(!inn)return null;

  const reset=()=>{setPhase(1);setShot(null);setArea(null);};
  const shotMeta=shot?ALL_SHOTS_FLAT.find(s=>s.id===shot):null;
  // Off pads/body = leg byes; beaten & ran = byes; otherwise off the bat.
  const runType=(v)=>{ if(v<=0)return "run"; if(shot==="padded"||shot==="hit_body")return "LB"; if(shot==="missed")return "B"; return "run"; };
  const commitRun=(v)=>{ onCommitDetailed(runType(v), v, shot, area?.seg??null, area?.zone??null); reset(); };
  const commitWkt=()=>{ onWicketCtx(shot, area?.seg??null, area?.zone??null); reset(); };

  const st=inn.batsmen.find(b=>b.id===inn.striker);
  const ns=inn.batsmen.find(b=>b.id===inn.nonStriker);
  const bw=inn.bowlers.find(b=>b.id===inn.bowler);
  const crr=inn.balls?((inn.runs/inn.balls)*6).toFixed(2):"0.00";
  const lastBalls=inn.ballLog.slice(-8);
  const req=target!=null?target-inn.runs:null;
  const ballsLeft=(match?.overs||20)*6-inn.balls;

  const ContextStrip=(
    <Card style={{padding:"14px 16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:"10px"}}>
        <div style={{fontFamily:D.mono,fontSize:"26px",fontWeight:700,color:D.textPrimary}}>
          {inn.runs}/{inn.wickets}<span style={{fontSize:"13px",color:D.textMuted}}> ({fmtOv(inn.balls)})</span>
        </div>
        <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textSecondary,textAlign:"right"}}>
          CRR {crr}{req!=null&&<div style={{color:req<=ballsLeft?D.emerald:D.rose}}>{req>0?`need ${req} off ${ballsLeft}`:"target reached"}</div>}
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:"4px",fontFamily:D.body,fontSize:"12px"}}>
        <div style={{display:"flex",justifyContent:"space-between"}}>
          <span style={{color:D.textPrimary,fontWeight:600}}>● {st?st.name:"—"}</span>
          <span style={{fontFamily:D.mono,color:D.textSecondary}}>{st?`${st.runs} (${st.balls})`:""}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between"}}>
          <span style={{color:D.textSecondary}}>{ns?ns.name:"—"}</span>
          <span style={{fontFamily:D.mono,color:D.textMuted}}>{ns?`${ns.runs} (${ns.balls})`:""}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",paddingTop:"5px",borderTop:`1px solid ${D.border}`}}>
          <span style={{color:D.textSecondary}}>🎳 {bw?bw.name:"—"}</span>
          <span style={{fontFamily:D.mono,color:D.textMuted}}>{bw?`${bw.wickets}/${bw.runs} (${fmtOv(bw.balls)})`:""}</span>
        </div>
      </div>
      {lastBalls.length>0&&(
        <div style={{display:"flex",gap:"5px",marginTop:"10px",overflowX:"auto"}}>
          {lastBalls.map((b,i)=><BallDot key={i} ball={b} size={24}/>)}
        </div>
      )}
    </Card>
  );

  // ── Quick mode: one-tap pad (speed over detail) ──
  /**
   * One key on the pad.
   *
   * `say` is the accessible name, and it is not optional dressing. Every key
   * on this pad is one or two characters — "4", "·", "WD", "↩" — which a
   * screen reader announces literally: "four", "middle dot", "W D", "leftwards
   * arrow with hook". None of those is a cricket outcome. Worse, the sub-label
   * that makes them legible to a sighted user is 7px, which is itself the
   * contrast failure design.md flags.
   *
   * So the visible face stays terse — a scorer is glancing at it between
   * deliveries — and the name says what actually happens.
   */
  const K=({label,sub,say,onClick,bg,fg,border,span,disabled})=>(
    <button onClick={onClick} disabled={disabled} className="pressBtn"
      aria-label={say ?? (sub ? `${label} — ${sub}` : label)} style={{
      gridColumn:span?`span ${span}`:"auto",minHeight:"60px",borderRadius:D.lg,cursor:disabled?"default":"pointer",opacity:disabled?.4:1,
      background:bg||D.surf2,border:`1px solid ${border||D.border}`,
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"2px"}}>
      {/* aria-hidden on the face: the button already has a name, and without
          this a screen reader reads the label, then the name, then the sub. */}
      <span aria-hidden="true" style={{fontFamily:D.mono,fontSize:"21px",fontWeight:700,color:fg||D.textPrimary,lineHeight:1}}>{label}</span>
      {/* §6.3 of the design audit, which calls this the single highest-priority
          visual fix in the product — and it is right. These are read by an
          untrained volunteer, outdoors, in direct sunlight, on a phone, under
          time pressure, where a mistap is unrecoverable data loss. They were
          simultaneously the smallest and lowest-contrast text in the system:
          7px at 2.26:1.

          WD and NB are two-letter tokens differentiated primarily by this
          caption, with W sitting next to both. At 2.26:1 in sunlight the
          caption is simply not there.

          10px minimum, the key's own accent where it has one, and the 0.12em
          tracking dropped — at this size it was costing legibility rather than
          adding refinement. */}
      {sub&&<span aria-hidden="true" style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.02em",color:fg?textOn(fg):D.textSecondary}}>{sub}</span>}
    </button>
  );
  if(quick){
    return (
      <div style={{maxWidth:"560px",margin:"0 auto",display:"flex",flexDirection:"column",gap:"12px"}}>
        {ContextStrip}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"8px"}}>
          <K label="·" sub="Dot" say="Dot ball, no run" onClick={()=>onCommitDetailed("run",0,null,null,null)}/>
          <K label="1" say="One run" onClick={()=>onCommitDetailed("run",1,null,null,null)}/>
          <K label="2" say="Two runs" onClick={()=>onCommitDetailed("run",2,null,null,null)}/>
          <K label="3" say="Three runs" onClick={()=>onCommitDetailed("run",3,null,null,null)}/>
          <K label="4" say="Four, boundary" onClick={()=>onCommitDetailed("run",4,null,null,null)} bg={D.indigo+"1c"} fg={D.indigo} border={D.indigo+"44"}/>
          <K label="6" say="Six, maximum" onClick={()=>onCommitDetailed("run",6,null,null,null)} bg={D.amber+"1c"} fg={D.amber} border={D.amber+"44"}/>
          <K label="WD" sub="Wide" say="Wide" onClick={onWide} bg={D.orange+"14"} fg={D.orange} border={D.orange+"33"}/>
          <K label="NB" sub="No ball" say="No ball" onClick={onNoBall} bg={D.amber+"10"} fg={D.amber} border={D.amber+"2a"}/>
          <K label="W" sub="Wicket" say="Wicket" onClick={()=>onWicketCtx(null,null,null)} bg={D.rose+"1c"} fg={D.rose} border={D.rose+"44"}/>
          <K label="↩" sub="Undo" say="Undo the last ball" onClick={onUndo} span={2}/>
          <button onClick={onToggleQuick} className="pressBtn" style={{minHeight:"60px",borderRadius:D.lg,cursor:"pointer",background:D.emerald+"12",border:`1px solid ${D.emerald}33`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"3px"}}>
            <span style={{fontSize:"14px"}}>🧭</span>
            <span style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",color:D.emerald}}>3-PHASE</span>
          </button>
        </div>
        <button onClick={onPro} className="pressBtn" style={{padding:"9px",borderRadius:D.lg,cursor:"pointer",background:"transparent",border:`1px dashed ${D.borderMed}`,fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",color:D.textSecondary}}>🎯 PRO MODE — full capture</button>
      </div>
    );
  }

  // ── 3-phase guided flow ──
  const StepChip=({n,label,val,done,onClick})=>{
    const active=phase===n;
    return (
      <button onClick={done?onClick:undefined} className="pressBtn" style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",gap:"2px",
        padding:"7px 6px",borderRadius:D.md,cursor:done?"pointer":"default",
        background:active?D.indigo+"1c":done?D.emerald+"12":D.surf2,
        border:`1px solid ${active?D.indigo+"55":done?D.emerald+"33":D.border}`}}>
        <span style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",color:active?D.indigo:done?D.emerald:D.textMuted}}>
          {done?"✓ ":""}{n} · {label}
        </span>
        <span style={{fontFamily:D.body,fontSize:"11px",fontWeight:600,color:val?D.textPrimary:D.textMuted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>{val||"—"}</span>
      </button>
    );
  };
  const shotChip=(s)=>{
    const on=shot===s.id;
    return (
      <button key={s.id} onClick={()=>{setShot(s.id);setPhase(2);}} className="pressBtn" style={{
        display:"flex",alignItems:"center",gap:"5px",padding:"9px 12px",borderRadius:D.md,cursor:"pointer",
        background:on?s.color+"22":D.surf2,border:`1px solid ${on?s.color+"66":D.border}`}}>
        <span style={{fontSize:"13px"}}>{s.icon}</span>
        <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:on?s.color:D.textPrimary}}>{s.label}</span>
      </button>
    );
  };

  return (
    <div style={{maxWidth:"560px",margin:"0 auto",display:"flex",flexDirection:"column",gap:"12px"}}>
      {ContextStrip}

      {/* Phase stepper */}
      <div style={{display:"flex",gap:"6px"}}>
        <StepChip n={1} label="SHOT"    val={shotMeta?shotMeta.label:null} done={phase>1} onClick={()=>setPhase(1)}/>
        <StepChip n={2} label="AREA"    val={area?SEGS[area.seg].label:(phase>2?"Didn’t travel":null)} done={phase>2} onClick={()=>setPhase(2)}/>
        <StepChip n={3} label="OUTCOME" val={null} done={false}/>
      </div>

      {/* PHASE 1 — shot played */}
      {phase===1&&(
        <Card style={{padding:"12px 14px"}}>
          {SHOT_CATS.map(c=>(
            <div key={c.cat} style={{marginBottom:"10px"}}>
              <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:c.color,marginBottom:"6px"}}>{c.cat}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>{c.shots.map(shotChip)}</div>
            </div>
          ))}
          <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"2px"}}>Tap the shot the batter played → then mark where it went.</div>
        </Card>
      )}

      {/* PHASE 2 — area on the field */}
      {phase===2&&(
        <Card style={{padding:"14px"}}>
          <WagonWheel ballLog={inn.ballLog} selSeg={area} onSel={(s)=>{setArea(s);setPhase(3);}}
            viewMode={wagonView} onViewMode={setWagonView} hidden={hidden} onToggle={()=>{}}/>
          <div style={{display:"flex",gap:"8px",marginTop:"12px"}}>
            <button onClick={()=>setPhase(1)} className="pressBtn" style={{flex:1,padding:"12px",borderRadius:D.lg,cursor:"pointer",background:D.surf2,border:`1px solid ${D.border}`,color:D.textSecondary,fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.05em"}}>‹ SHOT</button>
            <button onClick={()=>{setArea(null);setPhase(3);}} className="pressBtn" style={{flex:2,padding:"12px",borderRadius:D.lg,cursor:"pointer",background:D.surf3,border:`1px solid ${D.borderMed}`,color:D.textSecondary,fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.05em"}}>DIDN’T TRAVEL / BLOCKED ›</button>
          </div>
          <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"8px",textAlign:"center"}}>Tap where the ball went on the field.</div>
        </Card>
      )}

      {/* PHASE 3 — runs or wicket */}
      {phase===3&&(
        <Card style={{padding:"14px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"8px",marginBottom:"8px"}}>
            {[0,1,2,3,4,6].map(v=>(
              <button key={v} onClick={()=>commitRun(v)} className="pressBtn" style={{minHeight:"62px",borderRadius:D.lg,cursor:"pointer",
                background:v===6?D.amber+"1c":v===4?D.indigo+"1c":v===0?D.surf2:D.emerald+"14",
                border:`1px solid ${v===6?D.amber+"44":v===4?D.indigo+"44":v===0?D.border:D.emerald+"33"}`,
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                <span style={{fontFamily:D.mono,fontSize:"22px",fontWeight:700,color:v===6?D.amber:v===4?D.indigo:v===0?D.textPrimary:D.emerald}}>{v===0?"·":v}</span>
                {v===0&&<span style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",color:D.textSecondary}}>DOT</span>}
              </button>
            ))}
          </div>
          {/* byes / leg-byes transparency */}
          {(shot==="padded"||shot==="hit_body")&&<div style={{fontFamily:D.body,fontSize:"10px",color:D.orange,marginBottom:"8px",textAlign:"center"}}>Runs off the pads will be recorded as leg-byes.</div>}
          {shot==="missed"&&<div style={{fontFamily:D.body,fontSize:"10px",color:D.orange,marginBottom:"8px",textAlign:"center"}}>Runs after a miss will be recorded as byes.</div>}
          <button onClick={commitWkt} className="pressBtn" style={{width:"100%",padding:"14px",borderRadius:D.lg,cursor:"pointer",
            background:D.rose+"1c",border:`1px solid ${D.rose}55`,color:D.roseText,fontFamily:D.head,fontSize:"13px",fontWeight:800,letterSpacing:"0.08em",marginBottom:"8px"}}>
            🎯 WICKET
          </button>
          <button onClick={()=>setPhase(2)} className="pressBtn" style={{width:"100%",padding:"10px",borderRadius:D.lg,cursor:"pointer",background:D.surf2,border:`1px solid ${D.border}`,color:D.textSecondary,fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.05em"}}>‹ AREA</button>
        </Card>
      )}

      {/* Extras strip — not shots, always available */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"8px"}}>
        <K label="WD" sub="Wide" say="Wide" onClick={onWide} bg={D.orange+"14"} fg={D.orange} border={D.orange+"33"}/>
        <K label="NB" sub="No ball" say="No ball" onClick={onNoBall} bg={D.amber+"10"} fg={D.amber} border={D.amber+"2a"}/>
        <K label="↩" sub="Undo" say="Undo the last ball" onClick={()=>{ if(phase>1){reset();} else {onUndo();} }} bg={D.surf2}/>
      </div>

      {/* Mode toggles */}
      <div style={{display:"flex",gap:"8px"}}>
        <button onClick={onToggleQuick} className="pressBtn" style={{flex:1,padding:"9px",borderRadius:D.lg,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.08em",color:D.textSecondary}}>⚡ QUICK MODE</button>
        <button onClick={onPro} className="pressBtn" style={{flex:1,padding:"9px",borderRadius:D.lg,cursor:"pointer",background:"transparent",border:`1px dashed ${D.borderMed}`,fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.08em",color:D.textSecondary}}>🎯 PRO MODE</button>
      </div>
      <div style={{textAlign:"center",fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>
        {phase===1?"Phase 1 of 3 — select the shot played.":phase===2?"Phase 2 of 3 — select where it landed.":"Phase 3 of 3 — score runs or a wicket."} · Undo backs out of the current ball.
      </div>
    </div>
  );
}


export { FocusPad, ScoringHub, ScoringPanel };
