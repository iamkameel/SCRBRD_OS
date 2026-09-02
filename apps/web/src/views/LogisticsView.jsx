import { useState } from "react";
import { COACHES, COMPETITIONS, GROUNDS, MATCHES, PLAYERS, STAFF, WEATHER } from "../data/mock.js";
import { D } from "../design/tokens.js";
import { dateStr, today } from "../lib/format.js";
import { Avatar, Badge, Btn, Card, KPICard, SectionHeader } from "../ui/primitives.jsx";
import { WeatherChip } from "./shared.jsx";

// ══════════════════════════════════════════════════════
//  LOGISTICS VIEW  — full overhaul
// ══════════════════════════════════════════════════════
function LogisticsView({ role }) {
  const [tab,       setTab]       = useState("transport");
  const [manifest,  setManifest]  = useState(null);
  const canEdit = role==="superadmin"||role==="schooladmin"||role==="driver";

  const EQUIPMENT_INVENTORY = [
    { id:"eq1",  name:"Match Balls (Dukes)",      category:"Cricket",   qty:24, condition:"Good",      location:"Equipment Room A", lastAudit:"2025-02-01" },
    { id:"eq2",  name:"Practice Balls (White)",    category:"Cricket",   qty:48, condition:"Mixed",     location:"Equipment Room A", lastAudit:"2025-02-01" },
    { id:"eq3",  name:"Batting Helmets (Adult)",   category:"Protective",qty:12, condition:"Good",      location:"Equipment Room A", lastAudit:"2025-01-15" },
    { id:"eq4",  name:"Batting Helmets (Junior)",  category:"Protective",qty:8,  condition:"Fair",      location:"Equipment Room A", lastAudit:"2025-01-15" },
    { id:"eq5",  name:"Batting Pads (Full sets)",  category:"Protective",qty:18, condition:"Good",      location:"Equipment Room A", lastAudit:"2025-01-15" },
    { id:"eq6",  name:"Thigh Guards",              category:"Protective",qty:10, condition:"Good",      location:"Equipment Room A", lastAudit:"2025-01-15" },
    { id:"eq7",  name:"Wicket-Keeper Gloves",      category:"Protective",qty:4,  condition:"Good",      location:"Equipment Room A", lastAudit:"2025-01-15" },
    { id:"eq8",  name:"Batting Gloves (pairs)",    category:"Protective",qty:22, condition:"Mixed",     location:"Equipment Room A", lastAudit:"2025-01-15" },
    { id:"eq9",  name:"Stumps (Full sets)",        category:"Cricket",   qty:6,  condition:"Excellent", location:"Equipment Room B", lastAudit:"2025-01-10" },
    { id:"eq10", name:"Boundary Rope (80m)",       category:"Ground",    qty:3,  condition:"Good",      location:"Equipment Room B", lastAudit:"2025-01-10" },
    { id:"eq11", name:"Sight Screens",             category:"Ground",    qty:4,  condition:"Good",      location:"No.1 Ground",      lastAudit:"2025-01-10" },
    { id:"eq12", name:"Pitch Covers",              category:"Ground",    qty:2,  condition:"Good",      location:"No.1 Ground",      lastAudit:"2025-01-10" },
    { id:"eq13", name:"Bowling Machines",          category:"Training",  qty:2,  condition:"Excellent", location:"Net Shed",         lastAudit:"2025-01-20" },
    { id:"eq14", name:"Fielding Cradle",           category:"Training",  qty:1,  condition:"Good",      location:"Net Shed",         lastAudit:"2025-01-20" },
    { id:"eq15", name:"Coaching Cones (sets)",     category:"Training",  qty:8,  condition:"Good",      location:"Coaching Store",   lastAudit:"2025-01-20" },
    { id:"eq16", name:"First Aid Kits",            category:"Safety",    qty:4,  condition:"Stocked",   location:"Medical Room",     lastAudit:"2025-03-01" },
    { id:"eq17", name:"AED Defibrillator",         category:"Safety",    qty:1,  condition:"Certified", location:"Medical Room",     lastAudit:"2025-02-15" },
    { id:"eq18", name:"Ice Packs (reusable)",      category:"Safety",    qty:20, condition:"Good",      location:"Medical Room",     lastAudit:"2025-02-15" },
  ];

  const catColor = c => c==="Cricket"?D.sky:c==="Protective"?D.rose:c==="Ground"?D.teal:c==="Training"?D.violet:D.amber;
  const condColor = c => c==="Excellent"||c==="Stocked"||c==="Certified"?D.emerald:c==="Good"?D.sky:c==="Mixed"||c==="Fair"?D.amber:D.rose;

  const upcomingTransport = MATCHES.filter(m=>m.status==="upcoming"&&m.transport?.bus);

  return (
    <div className="os-page">
      <SectionHeader title="Logistics" sub="Transport, equipment inventory and ground scheduling" color={D.orange}/>

      <div style={{display:"flex",gap:"6px",marginBottom:"20px",flexWrap:"wrap"}}>
        {["transport","equipment","grounds"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
            padding:"6px 18px", borderRadius:D.pill, cursor:"pointer", textTransform:"capitalize",
            border:`1px solid ${tab===t?D.orange+"55":D.border}`,
            background:tab===t?D.orange+"14":"transparent",
            fontFamily:D.body, fontSize:"11px", fontWeight:tab===t?600:400,
            color:tab===t?D.orange:D.textMuted,
          }}>{t}</button>
        ))}
      </div>

      {/* ── TRANSPORT ── */}
      {tab==="transport"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"12px",marginBottom:"20px"}}>
            <KPICard label="Upcoming Away Trips" value={upcomingTransport.length} icon="🚌" color={D.sky}/>
            <KPICard label="Drivers Available"   value={STAFF.filter(s=>s.role==="driver"&&s.active).length} icon="🚌" color={D.lime}/>
            <KPICard label="Total Seats"         value={STAFF.filter(s=>s.role==="driver").flatMap(s=>s.vehicles).reduce((a,v)=>a+v.capacity,0)} icon="💺" color={D.violet}/>
            <KPICard label="Services Due"        value={STAFF.filter(s=>s.role==="driver").flatMap(s=>s.vehicles).filter(v=>{const d=(new Date(v.nextService)-today)/(86400000);return d<=14;}).length} icon="🔧" color={D.amber} sub="Within 14 days"/>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
            {upcomingTransport.map(m=>{
              const driver   = m.transport?.driverId ? STAFF.find(s=>s.id===m.transport.driverId) : null;
              const vehicle  = driver?.vehicles?.find(v=>v.reg===m.transport?.vehicle);
              const comp     = COMPETITIONS.find(c=>c.id===m.competition);
              const w        = WEATHER[m.id];
              const isManifest = manifest?.id===m.id;
              return (
                <Card key={m.id} sx={{border:`1px solid ${D.border}`,overflow:"visible"}}>
                  <div style={{padding:"16px"}}>
                    <div style={{display:"flex",gap:"14px",alignItems:"flex-start",flexWrap:"wrap"}}>
                      {/* Trip info */}
                      <div style={{flex:1,minWidth:"200px"}}>
                        <div style={{display:"flex",gap:"7px",marginBottom:"8px",flexWrap:"wrap"}}>
                          <Badge color={D.sky}>{m.homeTeam.split(" ").pop()}</Badge>
                          {comp&&<Badge color={D.indigo}>{comp.format}</Badge>}
                          {w&&<WeatherChip w={w} compact/>}
                        </div>
                        <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:D.textPrimary,marginBottom:"3px"}}>
                          {m.homeTeam} <span style={{color:D.textMuted,fontSize:"12px",fontWeight:400}}>vs</span> {m.awayTeam}
                        </div>
                        <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginBottom:"2px"}}>📅 {m.date} · 📍 {m.venue}</div>
                      </div>
                      {/* Timing block */}
                      <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                        <div style={{padding:"10px 14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,textAlign:"center",minWidth:"70px"}}>
                          <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"4px"}}>DEPARTS</div>
                          <div style={{fontFamily:D.mono,fontSize:"16px",fontWeight:700,color:D.sky}}>{m.transport.depart}</div>
                        </div>
                        <div style={{padding:"10px 14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,textAlign:"center",minWidth:"70px"}}>
                          <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"4px"}}>RETURNS</div>
                          <div style={{fontFamily:D.mono,fontSize:"16px",fontWeight:700,color:D.emerald}}>{m.transport.return}</div>
                        </div>
                        <div style={{padding:"10px 14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,textAlign:"center",minWidth:"70px"}}>
                          <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"4px"}}>SEATS</div>
                          <div style={{fontFamily:D.mono,fontSize:"16px",fontWeight:700,color:D.amber}}>{m.transport.seats||"?"}</div>
                        </div>
                      </div>
                    </div>

                    {/* Driver + vehicle strip */}
                    {driver&&(
                      <div style={{marginTop:"12px",padding:"10px 14px",background:D.surf2,borderRadius:D.md,display:"flex",gap:"14px",alignItems:"center",flexWrap:"wrap"}}>
                        <div style={{display:"flex",gap:"9px",alignItems:"center"}}>
                          <Avatar name={driver.name} size={32} color={D.lime}/>
                          <div>
                            <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>{driver.name}</div>
                            <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{driver.phone}</div>
                          </div>
                        </div>
                        {vehicle&&(
                          <>
                            <div style={{width:"1px",height:"32px",background:D.border}}/>
                            <div>
                              <div style={{fontFamily:D.mono,fontSize:"12px",fontWeight:700,color:D.lime}}>{vehicle.reg}</div>
                              <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{vehicle.type} · {vehicle.capacity} seats · <span style={{color:condColor(vehicle.condition)}}>{vehicle.condition}</span></div>
                            </div>
                          </>
                        )}
                        <div style={{marginLeft:"auto",display:"flex",gap:"6px"}}>
                          <Btn size="sm" variant="ghost" onClick={()=>setManifest(isManifest?null:m)}>
                            {isManifest?"Close Manifest":"📋 Manifest"}
                          </Btn>
                          {canEdit&&<Btn size="sm" variant="ghost">Edit</Btn>}
                        </div>
                      </div>
                    )}

                    {/* Passenger manifest */}
                    {isManifest&&(()=>{
                      const team = m.homeTeam.includes("U19")?PLAYERS.filter(p=>p.team==="U19A"):m.homeTeam.includes("U15")?PLAYERS.filter(p=>p.team==="U15A"):PLAYERS.filter(p=>p.team==="U13A");
                      const teamCoaches = COACHES.filter(c=>team.some(p=>c.team===p.team));
                      const allPassengers = [...team.map(p=>({name:p.name,type:"Player",team:p.team})), ...teamCoaches.map(c=>({name:c.name,type:"Coach",team:c.team}))];
                      return (
                        <div style={{marginTop:"12px",padding:"14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.teal}22`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                            <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.teal,letterSpacing:"0.08em"}}>TRAVEL MANIFEST — {allPassengers.length} PASSENGERS</div>
                            <Badge color={allPassengers.length<=(m.transport.seats||99)?D.emerald:D.rose}>{allPassengers.length}/{m.transport.seats||"?"} seats</Badge>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"6px"}}>
                            {allPassengers.map((p,i)=>(
                              <div key={i} style={{display:"flex",alignItems:"center",gap:"7px",padding:"6px 8px",background:D.surf1,borderRadius:D.sm}}>
                                <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,width:"16px"}}>{i+1}</span>
                                <Avatar name={p.name} size={22} color={p.type==="Coach"?D.emerald:D.sky}/>
                                <div>
                                  <div style={{fontFamily:D.body,fontSize:"10px",fontWeight:500,color:D.textPrimary,lineHeight:1.2}}>{p.name.split(" ").slice(-1)[0]}</div>
                                  <div style={{fontFamily:D.mono,fontSize:"8px",color:p.type==="Coach"?D.emerald:D.textMuted}}>{p.type}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div style={{marginTop:"10px",fontFamily:D.body,fontSize:"10px",color:D.textMuted,fontStyle:"italic"}}>
                            ⚠ All players must have signed indemnity forms. Medical kit carried by {STAFF.find(s=>s.role==="medical"&&s.active)?.name||"medical staff"}.
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </Card>
              );
            })}
            {upcomingTransport.length===0&&(
              <Card sx={{padding:"32px",textAlign:"center"}}>
                <div style={{fontSize:"32px",marginBottom:"10px"}}>🚌</div>
                <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted}}>No bus trips scheduled for upcoming fixtures.</div>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ── EQUIPMENT ── */}
      {tab==="equipment"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"12px",marginBottom:"20px"}}>
            <KPICard label="Total Line Items"  value={EQUIPMENT_INVENTORY.length} icon="📦" color={D.sky}/>
            <KPICard label="Needs Attention"   value={EQUIPMENT_INVENTORY.filter(e=>e.condition==="Fair"||e.condition==="Mixed").length} icon="⚠️" color={D.amber}/>
            <KPICard label="Match Balls"       value={EQUIPMENT_INVENTORY.find(e=>e.id==="eq1")?.qty||0} icon="🏏" color={D.indigo}/>
            <KPICard label="Safety Items"      value={EQUIPMENT_INVENTORY.filter(e=>e.category==="Safety").length} icon="🏥" color={D.rose}/>
          </div>
          <Card>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{background:D.surf2}}>
                    {["Item","Category","Qty","Condition","Location","Last Audit","Action"].map(h=>(
                      <th key={h} style={{padding:"10px 12px",fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {EQUIPMENT_INVENTORY.map((eq,i)=>(
                    <tr key={eq.id} style={{borderTop:`1px solid ${D.border}`,background:i%2===0?"transparent":D.surf2+"33"}}>
                      <td style={{padding:"10px 12px",fontFamily:D.body,fontSize:"12px",color:D.textPrimary,fontWeight:500}}>{eq.name}</td>
                      <td style={{padding:"10px 12px"}}><Badge color={catColor(eq.category)}>{eq.category}</Badge></td>
                      <td style={{padding:"10px 12px",fontFamily:D.mono,fontSize:"13px",fontWeight:600,color:D.textPrimary,textAlign:"center"}}>{eq.qty}</td>
                      <td style={{padding:"10px 12px"}}><Badge color={condColor(eq.condition)}>{eq.condition}</Badge></td>
                      <td style={{padding:"10px 12px",fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{eq.location}</td>
                      <td style={{padding:"10px 12px",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{eq.lastAudit}</td>
                      <td style={{padding:"10px 12px"}}>
                        {canEdit&&<button style={{background:"none",border:`1px solid ${D.border}`,borderRadius:D.sm,padding:"3px 9px",cursor:"pointer",fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>Edit</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── GROUNDS SCHEDULE ── */}
      {tab==="grounds"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:"12px"}}>
          {GROUNDS.map(g=>{
            const gk = STAFF.find(s=>s.id===g.groundskeeper);
            const todayMatches = MATCHES.filter(m=>m.groundId===g.id&&m.date===dateStr(today));
            const upcomingMatchesG = MATCHES.filter(m=>m.groundId===g.id&&m.status==="upcoming");
            return (
              <Card key={g.id} sx={{padding:"16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px"}}>
                  <div>
                    <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginBottom:"4px"}}>{g.name}</div>
                    <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
                      <Badge color={g.type==="turf"?D.emerald:g.type==="nets"?D.sky:D.amber}>{g.type}</Badge>
                      <Badge color={g.available?D.emerald:D.rose}>{g.available?"Open":"Closed"}</Badge>
                      {g.lights&&<Badge color={D.amber}>💡 Lights</Badge>}
                    </div>
                  </div>
                </div>
                {g.pitches&&(
                  <div style={{marginBottom:"10px"}}>
                    {g.pitches.filter(p=>p.condition!=="Resting"&&p.condition!=="Maintenance").map(p=>(
                      <div key={p.num} style={{padding:"5px 8px",background:D.surf2,borderRadius:D.sm,marginBottom:"4px",display:"flex",justifyContent:"space-between"}}>
                        <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Strip {p.num}</span>
                        <Badge color={p.condition==="Match-ready"?D.emerald:p.condition==="Good"?D.sky:D.amber}>{p.condition}</Badge>
                      </div>
                    ))}
                  </div>
                )}
                {todayMatches.length>0&&<div style={{marginBottom:"8px",padding:"6px 10px",background:D.emerald+"10",borderRadius:D.sm,border:`1px solid ${D.emerald}22`}}><span style={{fontFamily:D.body,fontSize:"11px",color:D.emerald}}>🏏 Match today: {todayMatches[0].homeTeam} vs {todayMatches[0].awayTeam}</span></div>}
                {upcomingMatchesG.length>0&&<div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"8px"}}>Next match: {upcomingMatchesG[0].date}</div>}
                {gk&&(
                  <div style={{display:"flex",alignItems:"center",gap:"7px",marginTop:"8px",paddingTop:"8px",borderTop:`1px solid ${D.border}`}}>
                    <Avatar name={gk.name} size={24} color={D.teal}/>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{gk.name}</span>
                    <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginLeft:"auto"}}>🌿 GK</span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { LogisticsView };
