
import { useState } from "react";
import { D, textOn } from "../design/tokens.js";
import { dateStr, today } from "../lib/format.js";
import { Avatar, Badge, Btn, Card, Input, Modal, Pill, SectionHeader, Select } from "../ui/primitives.jsx";
import { useLive, useRows } from "../lib/live.js";

// ══════════════════════════════════════════════════════
//  TRAINING VIEW
// ══════════════════════════════════════════════════════
function TrainingView({ role }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const COACHES = useRows("coaches", role);
  const PLAYERS = useRows("players", role);
  const TRAINING_SESSIONS = useRows("training", role);
  // The register is its own read, behind player.profile.read, because it is a
  // list of named minors and the session row is a noticeboard fact. A parent
  // who may read "training moved to four" must not receive every child who
  // was there. Joined here, per session, from whatever this person was sent —
  // which for that parent is nothing, and the card says nobody is attending
  // rather than crashing on a register it was never given.
  const REGISTER = useRows("training_attendance", role);
  // Each boy's load, with the server's word for it. Empty for anyone the
  // server does not hand it to (player.workload.read), and the panel is not
  // drawn; nothing here derives a state from a number.
  const LOAD = useRows("workload", role);
  // The drill library from the server; the constant below is the demo's.
  const { rows: LIVE_DRILLS, live: drillsLive } = useLive("drills", role);
  const attending = (s) => REGISTER.filter((a) => a.sessionId === s.id && a.status !== "absent").map((a) => a.playerId);
  const [view, setView] = useState("schedule");
  const [addModal, setAddModal] = useState(false);
  const canEdit = role==="superadmin"||role==="coach";

  const DRILLS_LIBRARY = [
    { id:"d1", name:"Throw-Downs",          category:"Batting",  duration:20, desc:"Coach delivers throw-downs to batters — front foot drives focus" },
    { id:"d2", name:"Short-Pitch Defence",   category:"Batting",  duration:15, desc:"Back-foot technique against short ball" },
    { id:"d3", name:"Target Bowling",        category:"Bowling",  duration:25, desc:"Cones placed at good length, bowlers aim for corridors" },
    { id:"d4", name:"Reaction Catches",      category:"Fielding", duration:15, desc:"Coach feeds ball randomly, fielders react" },
    { id:"d5", name:"Long Barrier Ground",   category:"Fielding", duration:20, desc:"Sliding long barrier practice on outfield" },
    { id:"d6", name:"12-3-6 Fitness",        category:"Fitness",  duration:20, desc:"Sprint work — 12 sprints × 3 sets × 6 seconds each" },
    { id:"d7", name:"Wrist Spin Variation",  category:"Bowling",  duration:30, desc:"Leggie/googly/flipper identification and execution drills" },
    { id:"d8", name:"Running Between Wickets",category:"Batting", duration:15, desc:"Calling, turning, sliding — team drill" },
    { id:"d9", name:"Slips Cordon",          category:"Fielding", duration:20, desc:"Edge catching off the catching cradle" },
    { id:"d10",name:"Strength & Conditioning",category:"Fitness", duration:45, desc:"Full S&C programme — gym-based or field-based" },
  ];

  const typeColor = t => t==="Batting"?D.sky:t==="Bowling"?D.violet:t==="Fielding"?D.emerald:t==="fitness"?D.amber:D.orange;

  return (
    <div className="os-page">
      <SectionHeader title="Training" sub="Session planner, drills library & attendance" color={D.emerald}
        actions={
          <div style={{display:"flex",gap:"6px"}}>
            <div style={{display:"flex",background:D.surf2,borderRadius:D.pill,padding:"3px",border:`1px solid ${D.border}`}}>
              {["schedule","drills"].map(v=>(
                <button key={v} onClick={()=>setView(v)} className="pressBtn" style={{
                  padding:"5px 14px",borderRadius:D.pill,border:"none",cursor:"pointer",
                  background:view===v?D.gradLive:"transparent",
                  color:view===v?"#fff":D.textMuted,fontFamily:D.head,fontSize:"10px",fontWeight:700,
                  letterSpacing:"0.06em",textTransform:"capitalize",
                }}>{v}</button>
              ))}
            </div>
            {canEdit&&<Btn size="sm" onClick={()=>setAddModal(true)}>+ Session</Btn>}
          </div>
        }/>

      {view==="schedule"&&LOAD.length>0&&<LoadPanel rows={LOAD}/>}

      {view==="schedule"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          {TRAINING_SESSIONS.map(s=>{
            // Live rows carry the coach's name; the demo carried an id.
            const coach = COACHES.find(c=>c.id===s.coach) ?? (s.coach ? { name: s.coach } : null);
            const roll = s.attendance ?? attending(s);
            const typeCol = s.type==="batting"?D.sky:s.type==="bowling"||s.type==="skills"?D.violet:s.type==="fitness"?D.amber:D.emerald;
            const isToday = s.date===dateStr(today);
            return (
              <Card key={s.id} sx={{border:`1px solid ${isToday?D.emerald+"33":D.border}`,background:isToday?D.emerald+"05":D.surf1}}>
                <div style={{padding:"14px 16px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
                    <div style={{width:"48px",textAlign:"center",flexShrink:0,padding:"6px",background:typeCol+"14",borderRadius:D.md,border:`1px solid ${typeCol}22`}}>
                      <div style={{fontFamily:D.mono,fontSize:"15px",fontWeight:700,color:typeCol}}>{new Date(s.date).getDate()}</div>
                      <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted,textTransform:"uppercase"}}>{new Date(s.date).toLocaleString("en",{month:"short"})}</div>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"3px"}}>
                        <span style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>{s.title}</span>
                        {isToday&&<Badge color={D.emerald}>Today</Badge>}
                        <Badge color={typeCol}>{s.type}</Badge>
                      </div>
                      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>
                        {s.team} · {s.time} · {s.duration}min · {s.venue} · {coach?.name||"Coach"}
                      </div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontFamily:D.mono,fontSize:"16px",fontWeight:700,color:D.amber}}>{roll.length}</div>
                      <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>attending</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"8px"}}>
                    {(s.drills??[]).map(d=><Pill key={d} color={typeCol}>{d}</Pill>)}
                  </div>
                  {s.notes&&<div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,fontStyle:"italic",background:D.surf2,padding:"7px 10px",borderRadius:D.sm}}>📝 {s.notes}</div>}
                  <div style={{display:"flex",gap:"4px",marginTop:"10px"}}>
                    {roll.map(pid=>{
                      const p=PLAYERS.find(pl=>pl.id===pid) ?? { name: REGISTER.find(a=>a.playerId===pid)?.name };
                      return p?.name?<div key={pid} title={p.name}><Avatar name={p.name} size={24} color={D.emerald}/></div>:null;
                    })}
                    {canEdit&&<button style={{width:"24px",height:"24px",borderRadius:"50%",background:D.surf3,border:`1px dashed ${D.border}`,cursor:"pointer",color:D.textMuted,fontSize:"12px",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {view==="drills"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:"12px"}}>
            {(drillsLive ? LIVE_DRILLS : DRILLS_LIBRARY).map(d=>(
              <Card key={d.id} sx={{padding:"14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px"}}>
                  <span style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{d.name}</span>
                  <Badge color={typeColor(d.category)}>{d.category}</Badge>
                </div>
                <p style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,lineHeight:1.5,marginBottom:"10px"}}>{d.desc}</p>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <Pill color={typeColor(d.category)}>⏱ {d.duration}min</Pill>
                  {canEdit&&<button style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.sky}}>Add to session</button>}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {addModal&&(
        <Modal title="Schedule Training Session" onClose={()=>setAddModal(false)}>
          <Input label="Session Title" value="" onChange={()=>{}} placeholder="e.g. Pre-Match Batting Practice"/>
          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
            <Select label="Team" value="1XI" onChange={()=>{}} options={["1XI","U15A","U13A"]}/>
            <Select label="Type" value="batting" onChange={()=>{}} options={["batting","bowling","fielding","fitness","skills","technical"]}/>
            <Input label="Date" value="" onChange={()=>{}} type="date"/>
            <Input label="Time" value="" onChange={()=>{}} type="time"/>
            <Input label="Duration (min)" value="" onChange={()=>{}} type="number" placeholder="90"/>
            <Select label="Venue" value="Nets 1-3" onChange={()=>{}} options={["Nets 1-3","Nets 4-5","Nets 6-7","Main Field","No.1 Ground"]}/>
          </div>
          <Input label="Notes" value="" onChange={()=>{}} placeholder="Session objectives and focus areas..."/>
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"8px"}}>
            <Btn variant="ghost" onClick={()=>setAddModal(false)}>Cancel</Btn>
            <Btn onClick={()=>setAddModal(false)}>Create Session</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// One row per boy, the breaches and spikes first because the server put
// them there. The word is the server's; the colour is ours.
const LOAD_TONE = { spike:D.rose, rising:D.amber, steady:D.emerald, light:D.sky, rested:D.textMuted, "no bowling":D.textMuted };
function LoadPanel({ rows }) {
  const flagged = rows.filter(r=>r.breaches28d>0||r.loadState==="spike").length;
  return (
    <Card sx={{padding:"16px",marginBottom:"14px"}} data-testid="load-panel">
      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
        <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>Bowling & training load</div>
        <Badge color={flagged?D.rose:D.emerald}>{flagged?`${flagged} to look at`:"nothing flagged"}</Badge>
        <span style={{marginLeft:"auto",fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>overs this week · this month · longest spell · sessions</span>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:D.body,fontSize:"11px"}}>
          <tbody>
            {rows.map(r=>(
              <tr key={r.playerId} data-testid={`load-row-${r.playerId}`} style={{borderTop:`1px solid ${D.border}`}}>
                <td style={{padding:"6px 8px",color:D.textPrimary,fontWeight:600,whiteSpace:"nowrap"}}>{r.name}
                  <span style={{marginLeft:"6px",fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{r.ageBand}{r.pace&&r.maxSpell?` · ${r.maxSpell}/${r.maxDay}`:""}</span></td>
                <td style={{padding:"6px 8px",fontFamily:D.mono,color:D.textSecondary,whiteSpace:"nowrap"}}>{r.overs7d} · {r.overs28d} · {r.longestSpell7d}</td>
                <td style={{padding:"6px 8px",fontFamily:D.mono,color:D.textSecondary,whiteSpace:"nowrap"}}>{r.sessions7d} ({r.minutes7d}m)</td>
                <td style={{padding:"6px 8px"}}>
                  <span style={{fontFamily:D.mono,fontSize:"9px",textTransform:"uppercase",padding:"2px 7px",borderRadius:D.pill,
                    background:(LOAD_TONE[r.loadState]??D.textMuted)+"14",border:`1px solid ${(LOAD_TONE[r.loadState]??D.textMuted)}33`,color:textOn(LOAD_TONE[r.loadState]??D.textMuted)}}>{r.loadState}{r.acwr!=null?` ${r.acwr}`:""}</span>
                  {r.breaches28d>0&&<span style={{marginLeft:"6px",fontFamily:D.mono,fontSize:"9px",color:D.roseText}}>{r.breaches28d} directive breach{r.breaches28d>1?"es":""}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export { TrainingView };
