import { useState } from "react";
import { COMPETITIONS, GROUNDS, MATCHES, STAFF, WEATHER } from "../data/mock.js";
import { D } from "../design/tokens.js";
import { canScore } from "../rbac/index.js";
import { SCRBRD } from "../scorer/engine.jsx";
import { Badge, Btn, Card, Pill, SectionHeader, StatusDot } from "../ui/primitives.jsx";
import { ScorecardModal, WeatherChip } from "./shared.jsx";

function MatchCentreView({ role, onOpenScorer, onNavProfile }) {
  const [filter, setFilter] = useState("all");
  const [selMatch, setSelMatch] = useState(null);
  const [cardM,    setCardM]    = useState(null);
  const filtered = MATCHES.filter(m=>filter==="all"||m.status===filter);
  return (
    <div className="os-page">
      <SectionHeader title="Match Centre" sub="Live scores, results, fixtures & weather" color={D.emerald}
        actions={
          <>
            {(role==="superadmin"||role==="schooladmin"||role==="coach")&&<Btn size="sm" onClick={()=>{}}>+ Schedule Match</Btn>}
            {canScore(role)&&<button onClick={()=>onOpenScorer(null)} className="pressBtn" style={{padding:"5px 12px",borderRadius:D.pill,background:D.emerald+"18",border:`1px solid ${D.emerald}30`,color:D.emerald,fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.05em",cursor:"pointer",display:"flex",alignItems:"center",gap:"5px"}}>
              <div className="live-dot"/>Open SCRBRD Scorer ↗
            </button>}
          </>
        }/>
      <div style={{display:"flex",gap:"6px",marginBottom:"20px"}}>
        {["all","live","upcoming","complete"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} className="pressBtn" style={{
            padding:"5px 14px",borderRadius:D.pill,border:`1px solid ${filter===f?D.indigo+"55":D.border}`,
            background:filter===f?D.indigo+"18":"transparent",cursor:"pointer",
            fontFamily:D.body,fontSize:"11px",fontWeight:filter===f?600:400,
            color:filter===f?D.textPrimary:D.textMuted,textTransform:"capitalize",
          }}>{f}</button>
        ))}
      </div>
      {cardM&&<ScorecardModal match={cardM} role={role} onClose={()=>setCardM(null)} onNavProfile={(id)=>{setCardM(null);onNavProfile&&onNavProfile(id);}}/>}
      <div style={{display:"grid",gridTemplateColumns:selMatch?"var(--g-side-r,1fr 340px)":"1fr",gap:"16px",alignItems:"start"}}>
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          {filtered.map(m=>{
            const comp = COMPETITIONS.find(c=>c.id===m.competition);
            const w = WEATHER[m.id];
            const isLive = m.status==="live";
            const isSel = selMatch?.id===m.id;
            return (
              <Card key={m.id} onClick={()=>setSelMatch(isSel?null:m)} sx={{
                background:isLive?`linear-gradient(135deg,${D.emerald}08,${D.surf1})`:D.surf1,
                border:`1px solid ${isSel?D.sky+"55":isLive?D.emerald+"22":D.border}`,cursor:"pointer",
              }}>
                <div style={{padding:"14px 16px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"10px",flexWrap:"wrap"}}>
                    <StatusDot status={m.status}/>
                    <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:isLive?D.emerald:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase"}}>{m.status}</span>
                    {comp&&<Badge color={D.sky}>{comp.name}</Badge>}
                    {w&&<WeatherChip w={w} compact/>}
                    <span style={{marginLeft:"auto",fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>{m.date}</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:"12px",alignItems:"center"}}>
                    <div>
                      <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:D.textPrimary}}>{m.homeTeam}</div>
                      {m.scorecard?.home&&<div style={{fontFamily:D.mono,fontSize:"18px",fontWeight:500,color:isLive?D.emerald:D.textPrimary,marginTop:"4px"}}>{m.scorecard.home.score} <span style={{fontSize:"12px",color:D.textMuted}}>({m.scorecard.home.overs})</span></div>}
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:800,color:D.textMuted,letterSpacing:"0.06em"}}>VS</div>
                      {m.result&&<div style={{fontFamily:D.body,fontSize:"10px",color:isLive?D.emerald:D.amber,marginTop:"4px",maxWidth:"120px"}}>{m.result}</div>}
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:D.textPrimary}}>{m.awayTeam}</div>
                      {m.scorecard?.away&&<div style={{fontFamily:D.mono,fontSize:"18px",fontWeight:500,color:D.textPrimary,marginTop:"4px"}}>{m.scorecard.away.score} <span style={{fontSize:"12px",color:D.textMuted}}>({m.scorecard.away.overs})</span></div>}
                    </div>
                  </div>
                  <div style={{marginTop:"10px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"6px"}}>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>📍 {m.venue}</span>
                    <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                      {m.transport?.bus&&<Pill color={D.sky}>🚌 Bus {m.transport.depart}</Pill>}
                      {isLive&&canScore(role)&&<Btn size="sm" variant="success" onClick={e=>{e.stopPropagation();onOpenScorer&&onOpenScorer(m);}}>Open Live Scorer →</Btn>}
                      {m.scorecard?.home&&<Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation();setCardM(m);}}>{m.status==="complete"?"Scorecard":"Live Scorecard"}</Btn>}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Match detail with full weather */}
        {selMatch&&(()=>{
          const w = WEATHER[selMatch.id];
          const scorer = selMatch.scorerId ? STAFF.find(s=>s.id===selMatch.scorerId) : null;
          const driver = selMatch.transport?.driverId ? STAFF.find(s=>s.id===selMatch.transport.driverId) : null;
          const ground = selMatch.groundId ? GROUNDS.find(g=>g.id===selMatch.groundId) : null;
          const pitch  = ground?.pitches?.[0];
          return (
            <Card sx={{padding:"16px",position:"sticky",top:"16px",maxHeight:"calc(100vh - 100px)",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"12px"}}>
                <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>Match Details</div>
                <button onClick={()=>setSelMatch(null)} style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"16px"}}>✕</button>
              </div>
              {w&&<div style={{marginBottom:"12px"}}><WeatherChip w={w}/></div>}
              {ground&&pitch&&(
                <div style={{marginBottom:"12px",background:D.surf2,borderRadius:D.md,padding:"10px 12px",border:`1px solid ${D.teal}22`}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.teal,letterSpacing:"0.08em",marginBottom:"7px"}}>PITCH REPORT</div>
                  {[["Ground",ground.shortName],["Strip",`No. ${pitch.num}`],["Surface",pitch.surface],["Condition",pitch.condition],["Bounce",pitch.bounce],["Seam Move",pitch.seamMovement||"—"],["Orientation",ground.orientation]].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${D.border}`}}>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                      <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textPrimary,fontWeight:500}}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
              {scorer&&(
                <div style={{marginBottom:"10px",padding:"9px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.orange}22`,display:"flex",alignItems:"center",gap:"9px"}}>
                  <span style={{fontSize:"16px"}}>📋</span>
                  <div>
                    <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.orange,letterSpacing:"0.06em"}}>SCORER</div>
                    <div style={{fontFamily:D.body,fontSize:"12px",color:D.textPrimary}}>{scorer.name}</div>
                    <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{scorer.scoringSystem}</div>
                  </div>
                </div>
              )}
              {driver&&selMatch.transport?.bus&&(
                <div style={{marginBottom:"10px",padding:"9px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.lime}22`}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.lime,letterSpacing:"0.06em",marginBottom:"5px"}}>TRANSPORT</div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>Driver</span>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary}}>{driver.name}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>Vehicle</span>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.lime}}>{selMatch.transport.vehicle}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>Departs / Returns</span>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.amber}}>{selMatch.transport.depart} / {selMatch.transport.return}</span>
                  </div>
                </div>
              )}
            </Card>
          );
        })()}
      </div>
    </div>
  );
}

export { MatchCentreView };
