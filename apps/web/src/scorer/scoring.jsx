import { Fragment } from "react";
import { D, T, inkOn, textOn } from "../design/tokens.js";
import { BatsmanChart, BowlerChart, ManhattanChart, RunRateChart, WormChart } from "./charts.jsx";
import { SEGS } from "./field.js";
import { RR, SR, fmtOv } from "./format.js";
import { batHandOf, positionName } from "@scrbrd/scoring";
import { CommentaryCard, WagonWheel } from "./panels.jsx";
import { seedCompletedMatch } from "./seed.js";
import { ALL_SHOTS_FLAT, SHOT_CATS } from "./shots.js";
import { Badge, Btn, Card, Lbl } from "./ui.jsx";
import { Select } from "../ui/primitives.jsx";
import { Icon } from "../ui/icons.jsx";

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
              color:i===hubStage?T.light.ink:i<hubStage?D.emerald:D.textMuted,
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
              {!hubApproach&&<span style={{fontFamily:D.body,fontSize:"10px",color:D.roseText,fontWeight:500}}><Icon name="triangle-alert"/> Required</span>}
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
                    color:isActive?T.light.ink:D.textMuted,
                    transition:"all .2s cubic-bezier(.34,1.56,.64,1)",
                    boxShadow:isActive?"0 2px 12px "+D.indigo+"40":"none",
                  }}>
                    {i===0?"Over the Wicket":"Around the Wicket"}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Shot grid — locked until approach selected */}
          {!hubApproach&&(
            <div style={{padding:"20px",textAlign:"center",borderRadius:D.md,border:"1px dashed "+D.border,
              background:D.surf2+"88",marginBottom:"10px"}}>
              <div style={{fontSize:"24px",marginBottom:"8px",color:D.textMuted}}><Icon name="bat"/></div>
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
                ? <><Icon name="map-pin"/> {positionName(selSeg.theta,selSeg.radius) ?? "placed"}</>
                : <><Icon name="map-pin"/> Tap where it went</>}
            </span>
          </div>
          <WagonWheel
            ballLog={inn?.ballLog||[]}
            selSeg={selSeg}
            batHand={batHand}
            // Whose shot each drawn ball was — not whoever happens to be on
            // strike now. Every ball carries the striker who faced it, so the
            // mirror is resolved per ball rather than once for the innings.
            handFor={b=>batHandOf(inn,b.strikerId)}
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
                <span style={{fontFamily:D.body,fontSize:"11px",color:textOn(shotInfo.color)}}>{shotInfo.label}</span>
              </div>
            )}
            {segInfo&&(
              <div style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 10px",
                borderRadius:D.md,background:D.indigo+"10",border:"1px solid "+D.indigo+"22"}}>
                <span style={{fontSize:"11px",color:D.sky}}><Icon name="map-pin"/></span>
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
            <Icon name="bails-off"/> Wicket
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
   SCORING PANEL  (pro mode: batsmen, bowler, hub, commentary)
   The score itself is on the board above the pad (pad.jsx), drawn once;
   this panel no longer repeats it.
═══════════════════════════════════════════════════════ */
function ScoringPanel({inn,innings,curIn,match,hubStage,hubShot,hubApproach,selSeg,
  fieldView,setFieldView,hidden,toggleLine,setModal,
  onApproach,onShot,onShotSkip,onFieldSel,onRun,onBye,onLegBye,onWicket,onWide,onNoBall,onReset,onBack,onUndo}){
  const bat1=inn?.batsmen.find(b=>b.id===inn.striker);
  const bat2=inn?.batsmen.find(b=>b.id===inn.nonStriker);
  const bow=inn?.bowlers.find(b=>b.id===inn.bowler);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
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
              <span style={{color:D.orange,fontSize:"12px"}}><Icon name="ball"/></span>
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
          <span style={{fontSize:"14px"}}><Icon name="undo-2"/></span>
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
   SCORING BLOCKED — SCRBRD-040
   The gate, said out loud. `readiness` is scoringReadiness(inn) from
   @scrbrd/scoring — the same value the engine checks before it records a
   delivery — so what this says and what the engine enforces are one answer
   read twice. It used to be a sheet that popped open on a tap with no reason
   given, or, with no innings open, nothing at all.
═══════════════════════════════════════════════════════ */
const OVER_CODES=new Set(["innings_over","innings_closed"]);
function ScoringBlocked({readiness,onFix}){
  if(!readiness||readiness.ready||!readiness.blocked?.length)return null;
  const [first,...rest]=readiness.blocked;
  // An innings that is over is not waiting on setup, so it does not get "yet".
  const lead=OVER_CODES.has(first.code)?"Can't score":"Can't score yet";
  return (
    <div role="status" aria-live="polite" data-testid="scoring-blocked" data-block={first.code}
      style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:"10px 14px",
        marginBottom:"12px",padding:"12px 14px",borderRadius:"12px",
        background:`${D.amber}12`,border:`1px solid ${D.amber}55`}}>
      <div style={{flex:"1 1 220px",minWidth:0}}>
        <div style={{fontFamily:D.body,fontSize:"14px",fontWeight:600,color:D.textPrimary,lineHeight:1.35}}>
          {lead}: {first.says}.
        </div>
        {rest.length>0&&(
          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,marginTop:"3px",lineHeight:1.35}}>
            Then: {rest.map(r=>r.says).join("; ")}.
          </div>
        )}
      </div>
      {first.fix&&onFix&&(
        <button onClick={()=>onFix(first)} className="pressBtn" data-testid="scoring-blocked-fix"
          style={{flexShrink:0,minHeight:"40px",padding:"8px 16px",borderRadius:D.pill,cursor:"pointer",
            border:"none",background:D.amber,color:inkOn(D.amber),
            fontFamily:D.head,fontSize:"13px",fontWeight:700,letterSpacing:"0.02em"}}>
          {first.fix}
        </button>
      )}
    </div>
  );
}

export { ScoringBlocked, ScoringHub, ScoringPanel };
