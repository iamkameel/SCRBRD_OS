import { useState } from "react";
import { D } from "../design/tokens.js";
import { pctDays, severityColor, today, withheld } from "../lib/format.js";
import { holdsCapability } from "../rbac/index.js";
import { Avatar, Badge, Card, KPICard, ProgressBar, ReadState, SectionHeader } from "../ui/primitives.jsx";
import { useLive } from "../lib/live.js";
import { readState } from "../lib/readState.js";

// ══════════════════════════════════════════════════════
//  INJURIES VIEW
// ══════════════════════════════════════════════════════
function InjuryView({ role }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  // Retry bumps the nonce both reads share: the same reads, the same role.
  const [nonce, setNonce] = useState(0);
  const playersRead = useLive("players", role, nonce);
  const PLAYERS = playersRead.rows;
  const [sel, setSel] = useState(null);
  const injuriesRead = useLive("injuries", role, nonce);
  const injV = injuriesRead.rows;
  // "Active injuries 0" over a read that failed is a count nobody made, and it
  // is the figure a coach acts on. A count is drawn only of an answer (GA-I08).
  const injSaid = readState(injuriesRead, { what: "the injury list" });
  const injAnswered = injSaid.state === "ok" || injSaid.state === "empty";
  const plSaid = readState(playersRead, { what: "players" });
  const plAnswered = plSaid.state === "ok" || plSaid.state === "empty";
  const n = (answered, v) => (answered ? v : "—");
  // A pupil reaches this screen through his own record (selfaccess) and reads
  // his own injuries only; the side's fitness count is the team-mates' health
  // (K3, db/55), drawn only for a role reading the status tier itself.
  const seesSide = holdsCapability(role, "medical.status.read");

  return (
    <div className="os-page">
      <SectionHeader title="Injury Management" sub="Tracker, return-to-play & rehab status" color={D.rose}/>

      {/* There is no route to log or update an injury yet, so no control for it
          is drawn: Update Progress, Clear for Training, Refer to Physio and the
          Log Injury form were buttons that did nothing. Reading stays as it is. */}
      <p data-testid="injury-writes-coming" style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,margin:"0 0 16px"}}>Recording and updating injuries is coming.</p>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"12px",marginBottom:"24px"}}>
        <KPICard label="Active Injuries" value={n(injAnswered, injV.filter(i=>i.restricted).length)}  icon="bandage" color={D.rose}/>
        <KPICard label="In Rehab"        value={n(injAnswered, injV.filter(i=>i.phase==="Reconditioning"||i.phase==="Strengthening").length)} icon="dumbbell" color={D.orange}/>
        <KPICard label="Returning Soon"  value={n(injAnswered, injV.filter(i=>{const d=(new Date(i.rtw)-today)/(1000*60*60*24);return d>=0&&d<=7;}).length)} icon="circle-check" color={D.amber}/>
        {seesSide&&<KPICard label="Available"       value={n(plAnswered, PLAYERS.filter(p=>p.fitness==="fit").length)} icon="footprints" color={D.emerald}/>}
      </div>
      {injSaid.state!=="ok"&&<Card sx={{marginBottom:"16px"}}><ReadState read={injSaid} onRetry={()=>setNonce(x=>x+1)} icon="bandage" testId="injuries-read-state"/></Card>}
      {injSaid.state==="ok"&&plSaid.state==="failed"&&<Card sx={{marginBottom:"16px"}}><ReadState compact read={plSaid} onRetry={()=>setNonce(x=>x+1)} testId="injuries-players-read-state"/></Card>}

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
                      {inj.severity&&<Badge color={sc}>{inj.severity}</Badge>}
                      <Badge color={inj.restricted?D.rose:D.emerald}>{inj.restricted?"Restricted":"Cleared"}</Badge>
                    </div>
                    <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:inj.type?sc:D.textMuted,marginBottom:"4px",fontStyle:inj.type?"normal":"italic"}}>{withheld(inj.type,"Details withheld")}</div>
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
                <div style={{fontFamily:D.body,fontSize:"12px",color:sel.type?sc:D.textMuted,marginTop:"3px",fontWeight:500,fontStyle:sel.type?"normal":"italic"}}>{withheld(sel.type,"Details withheld")}</div>
                {sel.severity&&<Badge color={sc} style={{marginTop:"6px"}}>{sel.severity}</Badge>}
              </div>

              {[["Phase",withheld(sel.phase,"—")],["Physio",withheld(sel.physio,"—")],["Date Injured",sel.dateInj],["Est. RTW",sel.rtw],["Days Remaining",`${daysLeft} days`]].map(([l,v])=>(
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

            </Card>
          );
        })()}
      </div>

    </div>
  );
}

export { InjuryView };
