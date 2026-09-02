import { useState } from "react";
import { PLAYERS } from "../data/mock.js";
import { D } from "../design/tokens.js";
import { pctDays, severityColor, today } from "../lib/format.js";
import { can, getData, principalForRole } from "../rbac/index.js";
import { Avatar, Badge, Btn, Card, Input, KPICard, Modal, ProgressBar, SectionHeader, Select } from "../ui/primitives.jsx";

// ══════════════════════════════════════════════════════
//  INJURIES VIEW
// ══════════════════════════════════════════════════════
function InjuryView({ role }) {
  const [addModal, setAddModal] = useState(false);
  const [sel, setSel] = useState(null);
  const canEdit = can(role,"injuries","update").allowed;
  const injV = getData("injuries", principalForRole(role));

  return (
    <div className="os-page">
      <SectionHeader title="Injury Management" sub="Tracker, return-to-play & rehab status" color={D.rose}
        actions={canEdit&&<Btn size="sm" onClick={()=>setAddModal(true)}>+ Log Injury</Btn>}/>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"12px",marginBottom:"24px"}}>
        <KPICard label="Active Injuries" value={injV.filter(i=>i.restricted).length}  icon="🏥" color={D.rose}/>
        <KPICard label="In Rehab"        value={injV.filter(i=>i.phase==="Reconditioning"||i.phase==="Strengthening").length} icon="💪" color={D.orange}/>
        <KPICard label="Returning Soon"  value={injV.filter(i=>{const d=(new Date(i.rtw)-today)/(1000*60*60*24);return d>=0&&d<=7;}).length} icon="✅" color={D.amber}/>
        <KPICard label="Available"       value={PLAYERS.filter(p=>p.fitness==="fit").length} icon="👟" color={D.emerald}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"var(--g-side-r,1fr 340px)",gap:"16px",alignItems:"start"}}>
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          {injV.map(inj=>{
            const player = PLAYERS.find(p=>p.id===inj.player);
            const pct = pctDays(inj.dateInj, inj.rtw);
            const daysLeft = Math.max(0,Math.ceil((new Date(inj.rtw)-today)/(1000*60*60*24)));
            const sc = severityColor(inj.severity);
            return (
              <Card key={inj.id} onClick={()=>setSel(inj)} sx={{
                cursor:"pointer",padding:"14px 16px",
                border:`1px solid ${sel?.id===inj.id?sc+"55":D.border}`,
                background:sel?.id===inj.id?sc+"06":D.surf1,
              }}>
                <div style={{display:"flex",gap:"12px",alignItems:"flex-start"}}>
                  <Avatar name={player?.name||"?"} size={40} color={sc}/>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px"}}>
                      <span style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{player?.name}</span>
                      <Badge color={sc}>{inj.severity}</Badge>
                      <Badge color={inj.restricted?D.rose:D.emerald}>{inj.restricted?"Restricted":"Cleared"}</Badge>
                    </div>
                    <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:sc,marginBottom:"4px"}}>{inj.type}</div>
                    <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"8px"}}>
                      Phase: <span style={{color:D.textSecondary,fontWeight:500}}>{inj.phase}</span> · Physio: {inj.physio}
                    </div>
                    <div style={{marginBottom:"4px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                        <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Recovery progress</span>
                        <span style={{fontFamily:D.mono,fontSize:"10px",color:sc,fontWeight:600}}>{pct}%</span>
                      </div>
                      <ProgressBar pct={pct} color={sc} height={6}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between"}}>
                      <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>Injured: {inj.dateInj}</span>
                      <span style={{fontFamily:D.body,fontSize:"10px",color:daysLeft<=3?D.emerald:D.textMuted}}>RTW: {inj.rtw} {daysLeft===0?"TODAY":daysLeft<=3?`(${daysLeft}d)`:""}</span>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Detail panel */}
        {sel&&(()=>{
          const player = PLAYERS.find(p=>p.id===sel.player);
          const sc = severityColor(sel.severity);
          const pct = pctDays(sel.dateInj, sel.rtw);
          const daysLeft = Math.max(0,Math.ceil((new Date(sel.rtw)-today)/(1000*60*60*24)));
          return (
            <Card sx={{padding:"16px",position:"sticky",top:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"16px"}}>
                <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>Injury Report</div>
                <button onClick={()=>setSel(null)} style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"16px"}}>✕</button>
              </div>
              <div style={{textAlign:"center",padding:"16px",background:sc+"10",borderRadius:D.md,border:`1px solid ${sc}22`,marginBottom:"14px"}}>
                <Avatar name={player?.name||"?"} size={56} color={sc}/>
                <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:D.textPrimary,marginTop:"10px"}}>{player?.name}</div>
                <div style={{fontFamily:D.body,fontSize:"12px",color:sc,marginTop:"3px",fontWeight:500}}>{sel.type}</div>
                <Badge color={sc} style={{marginTop:"6px"}}>{sel.severity}</Badge>
              </div>

              {[["Phase",sel.phase],["Physio",sel.physio],["Date Injured",sel.dateInj],["Est. RTW",sel.rtw],["Days Remaining",`${daysLeft} days`]].map(([l,v])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${D.border}`}}>
                  <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:l==="Days Remaining"&&daysLeft<=3?D.emerald:D.textPrimary,fontWeight:500}}>{v}</span>
                </div>
              ))}

              <div style={{marginTop:"12px",marginBottom:"12px"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:"6px"}}>
                  <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.06em"}}>RECOVERY</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:sc}}>{pct}%</span>
                </div>
                <ProgressBar pct={pct} color={sc} height={8}/>
              </div>

              <div style={{background:D.surf2,borderRadius:D.md,padding:"10px 12px",marginBottom:"12px"}}>
                <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"6px"}}>CLINICAL NOTES</div>
                <p style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.5}}>{sel.notes}</p>
              </div>

              {canEdit&&(
                <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                  <Btn size="sm" variant="success" onClick={()=>{}}>Update Progress</Btn>
                  <Btn size="sm" variant="ghost" onClick={()=>{}}>Clear for Training</Btn>
                  <Btn size="sm" variant="ghost" onClick={()=>{}}>Refer to Physio</Btn>
                </div>
              )}
            </Card>
          );
        })()}
      </div>

      {addModal&&(
        <Modal title="Log Injury" onClose={()=>setAddModal(false)}>
          <Select label="Player" value="" onChange={()=>{}} options={PLAYERS.map(p=>({value:p.id,label:`${p.name} (${p.team})`}))}/>
          <Input label="Injury Type" value="" onChange={()=>{}} placeholder="e.g. Hamstring Strain"/>
          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
            <Select label="Severity" value="mild" onChange={()=>{}} options={["mild","moderate","severe"]}/>
            <Select label="Phase" value="Initial" onChange={()=>{}} options={["Immobilisation","Reconditioning","Strengthening","Return to bowl","Return to bat","Cleared"]}/>
            <Input label="Date Injured" value="" onChange={()=>{}} type="date"/>
            <Input label="Est. Return to Play" value="" onChange={()=>{}} type="date"/>
            <Input label="Physio" value="" onChange={()=>{}} placeholder="Dr Smith"/>
          </div>
          <Input label="Clinical Notes" value="" onChange={()=>{}} placeholder="Describe the injury and treatment plan..."/>
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"8px"}}>
            <Btn variant="ghost" onClick={()=>setAddModal(false)}>Cancel</Btn>
            <Btn style={{background:D.rose+"18",border:`1px solid ${D.rose}33`,color:D.rose}} onClick={()=>setAddModal(false)}>Log Injury</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

export { InjuryView };
