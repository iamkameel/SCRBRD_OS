
import { ROLES } from "../design/roles.js";
import { D } from "../design/tokens.js";
import { dateStr, fitnessColor, today } from "../lib/format.js";
import { Avatar, Btn, Card, KPICard, Pill, StatusDot } from "../ui/primitives.jsx";
import { useRows } from "../lib/live.js";

// ══════════════════════════════════════════════════════
//  DASHBOARD VIEW
// ══════════════════════════════════════════════════════
function DashboardView({ role, onNav }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const COMPETITIONS = useRows("competitions", role);
  const INJURIES = useRows("injuries", role);
  const MATCHES = useRows("matches", role);
  const NOTIFICATIONS = useRows("notifications", role);
  const PLAYERS = useRows("players", role);
  const TRAINING_SESSIONS = useRows("training", role);
  const rc = ROLES[role];
  const liveMatch = MATCHES.find(m=>m.status==="live");
  const upcomingMatches = MATCHES.filter(m=>m.status==="upcoming").slice(0,3);
  const injuries = INJURIES.filter(i=>i.restricted);
  const unreadNotifs = NOTIFICATIONS.filter(n=>!n.read).length;

  return (
    <div className="os-page">
      <div style={{marginBottom:"20px"}}>
        <h1 style={{fontFamily:D.head,fontSize:"22px",fontWeight:800,color:D.textPrimary,marginBottom:"3px"}}>
          Welcome back, {rc.icon} <span style={{color:rc.color}}>{rc.label}</span>
        </h1>
        <p style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted}}>Hilton College, KZN · {new Date().toLocaleDateString("en-ZA",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
      </div>

      {/* KPI row */}
      {(role==="superadmin"||role==="schooladmin"||role==="coach")&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:"12px",marginBottom:"24px"}}>
          <KPICard label="Active Players" value="53"  icon="👥" color={D.sky}    trend={+5}  sub="Across 3 squads"/>
          <KPICard label="League Position" value="1st" icon="🏆" color={D.amber}  sub="4W-1L · 8pts"    />
          <KPICard label="Win Rate"        value="72%" icon="📈" color={D.emerald}trend={+8}  sub="Last 12 matches"/>
          <KPICard label="Injuries"        value={injuries.length} icon="🏥" color={injuries.length>3?D.rose:D.orange} sub="Active restrictions"/>
          <KPICard label="Sessions This Wk"value="4"  icon="💪" color={D.violet} sub="Next: Today 14:30"/>
          <KPICard label="Alerts"          value={unreadNotifs} icon="🔔" color={D.rose} sub="Unread notifications"/>
        </div>
      )}
      {role==="player"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:"12px",marginBottom:"24px"}}>
          <KPICard label="Batting Avg"    value="48.2" icon="🏏" color={D.sky}     trend={+12} sub="Season"/>
          <KPICard label="Strike Rate"    value="135"  icon="⚡" color={D.amber}    trend={+4}  sub="Season"/>
          <KPICard label="Next Training"  value="Today" icon="💪" color={D.emerald} sub="14:30 — Nets 1-3"/>
          <KPICard label="Next Match"     value="Sat"  icon="📅" color={D.violet}   sub="vs Kearsney College"/>
        </div>
      )}
      {role==="parent"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:"12px",marginBottom:"24px"}}>
          <KPICard label="Next Match"    value="Sat"   icon="📅" color={D.sky}    sub="vs Kearsney Away"/>
          <KPICard label="Transport"     value="Bus ✓" icon="🚌" color={D.emerald} sub="Departs 08:00"/>
          <KPICard label="Season Avg"    value="48.2"  icon="🏏" color={D.amber}   sub="James Whitfield"/>
          <KPICard label="Alerts"        value={unreadNotifs} icon="🔔" color={D.rose} sub="Unread"/>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"var(--g-side-r,1fr 340px)",gap:"16px",alignItems:"start"}}>
        {/* Left column */}
        <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>

          {/* Live match */}
          {liveMatch&&(
            <Card sx={{background:`linear-gradient(135deg,${D.emerald}0a,${D.surf1})`,border:`1px solid ${D.emerald}22`}}>
              <div style={{padding:"14px 16px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"12px"}}>
                  <div className="live-dot"/>
                  <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.emerald,letterSpacing:"0.1em"}}>LIVE MATCH</span>
                  <span style={{marginLeft:"auto",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Hilton vs Kearsney · T20</span>
                </div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div>
                    <div style={{fontFamily:D.head,fontSize:"28px",fontWeight:800,color:D.textPrimary}}>{liveMatch.scorecard.home.score}</div>
                    <div style={{fontFamily:D.mono,fontSize:"12px",color:D.textMuted}}>({liveMatch.scorecard.home.overs} overs) · Hilton U19A</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,marginBottom:"6px"}}>Target: 187 to win</div>
                    <div style={{fontFamily:D.mono,fontSize:"12px",color:D.amber}}>CRR: 9.95 · RRR: 8.21</div>
                  </div>
                </div>
                <div style={{marginTop:"12px"}}>
                  <Btn onClick={()=>onNav("matches")} variant="success" size="sm">Open Match Centre →</Btn>
                </div>
              </div>
            </Card>
          )}

          {/* Upcoming fixtures */}
          <Card>
            <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>Upcoming Fixtures</span>
              <button onClick={()=>onNav("logistics")} style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.sky}}>View all →</button>
            </div>
            {upcomingMatches.map(m=>(
              <div key={m.id} style={{padding:"12px 16px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"12px"}}>
                <div style={{width:"42px",textAlign:"center",flexShrink:0}}>
                  <div style={{fontFamily:D.mono,fontSize:"16px",fontWeight:700,color:D.textPrimary}}>{new Date(m.date).getDate()}</div>
                  <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted,textTransform:"uppercase"}}>{new Date(m.date).toLocaleString("en",{month:"short"})}</div>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary,marginBottom:"2px"}}>{m.homeTeam} vs {m.awayTeam}</div>
                  <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>📍 {m.venue}</div>
                </div>
                {m.transport?.bus&&<Pill color={D.sky}>🚌 Bus</Pill>}
                <StatusDot status={m.status}/>
              </div>
            ))}
          </Card>

          {/* Squad fitness overview */}
          {(role==="coach"||role==="superadmin"||role==="schooladmin")&&(
            <Card>
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>Squad Fitness — U19A</span>
                <button onClick={()=>onNav("injuries")} style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.sky}}>Injury log →</button>
              </div>
              <div style={{padding:"12px 16px",display:"flex",flexWrap:"wrap",gap:"10px"}}>
                {PLAYERS.filter(p=>p.team==="U19A").map(p=>(
                  <div key={p.id} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"4px"}}>
                    <div style={{position:"relative"}}>
                      <Avatar name={p.name} size={36} color={fitnessColor(p.fitness)}/>
                      <div style={{position:"absolute",bottom:-2,right:-2,width:"10px",height:"10px",borderRadius:"50%",background:fitnessColor(p.fitness),border:`1.5px solid ${D.surf1}`}}/>
                    </div>
                    <span style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted}}>{p.name.split(" ").pop()}</span>
                  </div>
                ))}
              </div>
              <div style={{padding:"8px 16px",borderTop:`1px solid ${D.border}`,display:"flex",gap:"16px"}}>
                {[["fit",D.emerald],["rehab",D.orange],["injured",D.rose]].map(([s,c])=>(
                  <div key={s} style={{display:"flex",alignItems:"center",gap:"5px"}}>
                    <div style={{width:"7px",height:"7px",borderRadius:"50%",background:c}}/>
                    <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,textTransform:"capitalize"}}>{s}: {PLAYERS.filter(p=>p.team==="U19A"&&p.fitness===s).length}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>

          {/* League table mini.
              Rendered only when this person can actually read a competition
              with standings in it. COMPETITIONS comes through the choke point,
              so for a role without competition.read it is EMPTY — and reading
              [0].table off an empty array threw, taking the whole dashboard
              down. A scorer is exactly such a role, which is why nobody found
              it until one signed in.

              This is the shape of bug that scoped reads create: the data
              correctly disappears, and a card written when it could not
              disappear falls over. A card with nothing to show should render
              nothing. */}
          {COMPETITIONS[0]?.table?.length>0&&(
          <Card>
            <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`}}>
              <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>{COMPETITIONS[0].name}</div>
              <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginTop:"2px"}}>TOP 6</div>
            </div>
            {COMPETITIONS[0].table.map((t,i)=>(
              <div key={t.team} style={{padding:"8px 14px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"8px",background:t.team.includes("Hilton")?D.indigo+"0a":"transparent"}}>
                <span style={{fontFamily:D.mono,fontSize:"11px",fontWeight:700,color:i===0?D.amber:D.textMuted,width:"14px"}}>{i+1}</span>
                <span style={{flex:1,fontFamily:D.body,fontSize:"11px",fontWeight:t.team.includes("Hilton")?600:400,color:t.team.includes("Hilton")?D.textPrimary:D.textSecondary}}>{t.team}</span>
                <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>{t.W}W</span>
                <span style={{fontFamily:D.mono,fontSize:"11px",fontWeight:700,color:t.team.includes("Hilton")?D.emerald:D.textSecondary}}>{t.pts}</span>
              </div>
            ))}
            <div style={{padding:"8px 14px"}}>
              <button onClick={()=>onNav("competitions")} style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.sky}}>Full standings →</button>
            </div>
          </Card>
          )}

          {/* Recent notifications */}
          <Card>
            <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>Recent Alerts</span>
              <button onClick={()=>onNav("notifications")} style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.sky}}>All →</button>
            </div>
            {NOTIFICATIONS.slice(0,4).map(n=>{
              const ic = n.type==="match"?"🏏":n.type==="injury"?"🏥":n.type==="training"?"💪":n.type==="transport"?"🚌":"📢";
              const uc = n.urgency==="high"?D.rose:n.urgency==="medium"?D.amber:D.textMuted;
              return (
                <div key={n.id} style={{padding:"9px 14px",borderBottom:`1px solid ${D.border}`,background:n.read?"transparent":D.indigo+"06"}}>
                  <div style={{display:"flex",gap:"8px",alignItems:"flex-start"}}>
                    <span style={{fontSize:"13px",flexShrink:0,marginTop:"1px"}}>{ic}</span>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"2px"}}>
                        <span style={{fontFamily:D.body,fontSize:"11px",fontWeight:n.read?400:600,color:D.textPrimary}}>{n.title}</span>
                        {!n.read&&<div style={{width:"5px",height:"5px",borderRadius:"50%",background:uc,flexShrink:0,marginTop:"3px"}}/>}
                      </div>
                      <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{n.body}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>

          {/* Today's training */}
          <Card>
            <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`}}>
              <span style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>Today's Sessions</span>
            </div>
            {TRAINING_SESSIONS.filter(s=>s.date===dateStr(today)).map(s=>(
              <div key={s.id} style={{padding:"10px 14px",borderBottom:`1px solid ${D.border}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:"3px"}}>
                  <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>{s.title}</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.amber}}>{s.time}</span>
                </div>
                <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{s.team} · {s.venue} · {s.duration}min</div>
              </div>
            ))}
            <div style={{padding:"8px 14px"}}>
              <button onClick={()=>onNav("training")} style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.sky}}>Full schedule →</button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export { DashboardView };
