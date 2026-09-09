
import { useState } from "react";
import { ROLES } from "../design/roles.js";
import { D } from "../design/tokens.js";
import { roleColor } from "../lib/format.js";
import { Avatar, Badge, Btn, Card, Pill, SectionHeader } from "../ui/primitives.jsx";
import { useRows } from "../lib/live.js";

// ══════════════════════════════════════════════════════
//  STAFF VIEW — scorers, medical, drivers, groundskeepers
// ══════════════════════════════════════════════════════
function StaffView({ role }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const GROUNDS = useRows("grounds", role);
  const STAFF = useRows("staff", role);
  const [filter, setFilter] = useState("all");
  const [sel, setSel]       = useState(null);
  const canEdit = role==="superadmin"||role==="schooladmin";

  const roleIcon  = r => r==="scorer"?"📋":r==="medical"?"⚕️":r==="driver"?"🚌":r==="groundskeeper"?"🌿":"👤";
  const roleColor = r => ROLES[r]?.color || D.textMuted;
  const filtered  = filter==="all" ? STAFF : STAFF.filter(s=>s.role===filter);

  return (
    <div className="os-page">
      <SectionHeader title="Staff Profiles" sub="Scorers · Medical · Drivers · Groundskeepers" color={D.cyan}
        actions={canEdit&&<Btn size="sm">+ Add Staff</Btn>}/>

      <div style={{display:"flex",gap:"6px",marginBottom:"20px",flexWrap:"wrap"}}>
        {["all","scorer","medical","driver","groundskeeper"].map(f=>(
          <button key={f} onClick={()=>{setFilter(f);setSel(null);}} className="pressBtn" style={{
            padding:"6px 16px",borderRadius:D.pill,cursor:"pointer",textTransform:"capitalize",
            border:`1px solid ${filter===f?(ROLES[f]?.color||D.cyan)+"55":D.border}`,
            background:filter===f?(ROLES[f]?.color||D.cyan)+"14":"transparent",
            fontFamily:D.body,fontSize:"11px",fontWeight:filter===f?600:400,
            color:filter===f?D.textPrimary:D.textMuted,
          }}>{f==="all"?"All Staff":`${roleIcon(f)} ${f.charAt(0).toUpperCase()+f.slice(1)}s`}</button>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:sel?"1fr 360px":"repeat(auto-fill,minmax(260px,1fr))",gap:"14px",alignItems:"start"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:"12px"}}>
          {filtered.map(s=>{
            const rc = ROLES[s.role];
            return (
              <Card key={s.id} onClick={()=>setSel(s)} sx={{
                padding:"16px",cursor:"pointer",
                border:`1px solid ${sel?.id===s.id?roleColor(s.role)+"55":D.border}`,
                background:sel?.id===s.id?roleColor(s.role)+"08":D.surf1,
              }}>
                <div style={{display:"flex",gap:"12px",alignItems:"flex-start",marginBottom:"12px"}}>
                  <div style={{position:"relative"}}>
                    <Avatar name={s.name} size={44} color={roleColor(s.role)}/>
                    <div style={{position:"absolute",bottom:-2,right:-2,width:"14px",height:"14px",borderRadius:"50%",
                      background:s.active?D.emerald:D.rose,border:`2px solid ${D.surf1}`,
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:"9px"}}>
                      {roleIcon(s.role)}
                    </div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginBottom:"2px"}}>{s.name}</div>
                    <Badge color={roleColor(s.role)}>{roleIcon(s.role)} {s.role}</Badge>
                  </div>
                </div>
                <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"8px",lineHeight:1.4}}>
                  {s.experience?.split(".")[0]}.
                </div>
                <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                  <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{s.phone}</span>
                  {s.vehicles&&<Badge color={D.lime}>{s.vehicles.length} vehicle{s.vehicles.length>1?"s":""}</Badge>}
                  {s.teamsAssigned&&<Badge color={D.sky}>{s.teamsAssigned.join(" · ")}</Badge>}
                </div>
              </Card>
            );
          })}
        </div>

        {/* Detail panel */}
        {sel&&(()=>{
          const rc = ROLES[sel.role];
          return (
            <Card sx={{padding:"16px",position:"sticky",top:"16px",maxHeight:"calc(100vh - 100px)",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"16px"}}>
                <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
                  <Avatar name={sel.name} size={48} color={roleColor(sel.role)}/>
                  <div>
                    <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,lineHeight:1.2}}>{sel.name}</div>
                    <div style={{marginTop:"4px",display:"flex",gap:"4px",flexWrap:"wrap"}}>
                      <Badge color={roleColor(sel.role)}>{roleIcon(sel.role)} {sel.role}</Badge>
                      <Badge color={sel.active?D.emerald:D.rose}>{sel.active?"Active":"Inactive"}</Badge>
                    </div>
                  </div>
                </div>
                <button onClick={()=>setSel(null)} style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"16px",flexShrink:0}}>✕</button>
              </div>

              {/* Contact */}
              <div style={{background:D.surf2,borderRadius:D.md,padding:"10px 12px",marginBottom:"12px"}}>
                {[["📞 Phone",sel.phone],["✉️ Email",sel.email],sel.age&&["🎂 Age",`${sel.age} years`]].filter(Boolean).map(([l,v])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${D.border}`}}>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                    <span style={{fontFamily:sel.email&&l.includes("Email")?D.mono:D.body,fontSize:"11px",color:D.textPrimary}}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Qualifications */}
              <div style={{marginBottom:"12px"}}>
                <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"7px"}}>QUALIFICATIONS</div>
                {sel.qualifications?.map(q=>(
                  <div key={q} style={{display:"flex",alignItems:"center",gap:"7px",padding:"4px 0"}}>
                    <div style={{width:"5px",height:"5px",borderRadius:"50%",background:roleColor(sel.role),flexShrink:0}}/>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{q}</span>
                  </div>
                ))}
              </div>

              {/* Experience */}
              <div style={{marginBottom:"12px",background:D.surf2,borderRadius:D.md,padding:"10px 12px"}}>
                <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"6px"}}>EXPERIENCE</div>
                <p style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.5}}>{sel.experience}</p>
              </div>

              {/* Role-specific fields */}
              {sel.role==="scorer"&&(
                <div style={{marginBottom:"12px"}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"7px"}}>SCORING SETUP</div>
                  {[["System",sel.scoringSystem],["Teams",sel.teamsAssigned?.join(", ")],["Languages",sel.languages?.join(", ")],["Availability",sel.availability]].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${D.border}`}}>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,textAlign:"right",maxWidth:"60%"}}>{v}</span>
                    </div>
                  ))}
                  <div style={{marginTop:"8px"}}>
                    <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"5px"}}>EQUIPMENT</div>
                    <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>{sel.equipment?.map(e=><Pill key={e} color={D.orange}>{e}</Pill>)}</div>
                  </div>
                </div>
              )}

              {sel.role==="medical"&&(
                <div style={{marginBottom:"12px"}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"7px"}}>MEDICAL PROFILE</div>
                  {[["Specialisation",sel.specialisation],["Registered",sel.registeredWith],["Availability",sel.availability]].filter(([,v])=>v).map(([l,v])=>(
                    <div key={l} style={{padding:"5px 0",borderBottom:`1px solid ${D.border}`}}>
                      <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{l}</div>
                      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,marginTop:"2px"}}>{v}</div>
                    </div>
                  ))}
                  {sel.concussionProtocol&&(
                    <div style={{marginTop:"8px",background:D.rose+"10",borderRadius:D.sm,padding:"8px 10px",border:`1px solid ${D.rose}22`}}>
                      <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.roseText,letterSpacing:"0.08em",marginBottom:"4px"}}>CONCUSSION PROTOCOL</div>
                      <div style={{fontFamily:D.body,fontSize:"10px",color:D.textSecondary}}>{sel.concussionProtocol}</div>
                    </div>
                  )}
                  <div style={{marginTop:"8px"}}>
                    <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"5px"}}>EMERGENCY EQUIPMENT</div>
                    <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>{sel.emergencyEquipment?.map(e=><Pill key={e} color={D.rose}>{e}</Pill>)}</div>
                  </div>
                </div>
              )}

              {sel.role==="driver"&&(
                <div style={{marginBottom:"12px"}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"7px"}}>VEHICLES</div>
                  {sel.vehicles?.map(v=>(
                    <div key={v.reg} style={{padding:"10px 12px",background:D.surf2,borderRadius:D.md,marginBottom:"8px",border:`1px solid ${D.border}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                        <span style={{fontFamily:D.mono,fontSize:"12px",fontWeight:700,color:D.lime}}>{v.reg}</span>
                        <Badge color={v.condition==="Excellent"?D.emerald:v.condition==="Good"?D.sky:D.amber}>{v.condition}</Badge>
                      </div>
                      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{v.type} · {v.capacity} seats</div>
                      <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,marginTop:"3px"}}>Next service: {v.nextService}</div>
                    </div>
                  ))}
                  <div style={{marginTop:"6px"}}>
                    <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"5px"}}>REGULAR ROUTES</div>
                    {sel.regularRoutes?.map(r=>(
                      <div key={r} style={{padding:"4px 0",display:"flex",gap:"7px",alignItems:"center"}}>
                        <span style={{color:D.lime}}>→</span>
                        <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sel.role==="groundskeeper"&&(
                <div style={{marginBottom:"12px"}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"7px"}}>GROUNDS PROFILE</div>
                  {[["Assigned Grounds",sel.groundsAssigned?.map(id=>GROUNDS.find(g=>g.id===id)?.shortName).join(", ")],["Speciality",sel.speciality],["Pitch Prep",sel.pitchPreparation]].filter(([,v])=>v).map(([l,v])=>(
                    <div key={l} style={{padding:"6px 0",borderBottom:`1px solid ${D.border}`}}>
                      <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{l}</div>
                      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,marginTop:"2px"}}>{v}</div>
                    </div>
                  ))}
                  <div style={{marginTop:"8px"}}>
                    <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"5px"}}>EQUIPMENT</div>
                    <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>{sel.equipment?.map(e=><Pill key={e} color={D.teal}>{e}</Pill>)}</div>
                  </div>
                </div>
              )}

              {sel.notes&&(
                <div style={{background:D.amber+"0a",borderRadius:D.md,padding:"9px 12px",border:`1px solid ${D.amber}18`}}>
                  <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.amber,letterSpacing:"0.08em",marginBottom:"4px"}}>NOTES</div>
                  <p style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.5}}>{sel.notes}</p>
                </div>
              )}
            </Card>
          );
        })()}
      </div>
    </div>
  );
}

export { StaffView };
