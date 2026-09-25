
import { Fragment, useState } from "react";
import { holdsCapability } from "../rbac/index.js";
import { D, T, textOn, themed } from "../design/tokens.js";
import { dateStr, today } from "../lib/format.js";
import { Avatar, Badge, Btn, Card, Input, Modal, Pill, SectionHeader, Select } from "../ui/primitives.jsx";
import { useLive, useRows } from "../lib/live.js";
import { api } from "../lib/api.js";
import { schoolsWhere } from "../lib/session.js";

// ══════════════════════════════════════════════════════
//  TRAINING VIEW
// ══════════════════════════════════════════════════════
function TrainingView({ role }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const [sessionNonce, setSessionNonce] = useState(0);
  const COACHES = useRows("coaches", role);
  const PLAYERS = useRows("players", role);
  const TRAINING_SESSIONS = useRows("training", role, sessionNonce);
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
  const [drillNonce, setDrillNonce] = useState(0);
  const { rows: LIVE_DRILLS, live: drillsLive } = useLive("drills", role, drillNonce);
  // Which schools this person's roles could keep a drill library for. Layout
  // only: the insert is refused by the drill policy regardless of what is
  // drawn here, and the form says so in the server's words when it is.
  const drillSchools = schoolsWhere("team.manage");
  const attending = (s) => REGISTER.filter((a) => a.sessionId === s.id && a.status !== "absent").map((a) => a.playerId);
  const [view, setView] = useState("schedule");
  const [addModal, setAddModal] = useState(false);
  const canEdit = holdsCapability(role,"team.manage");   // the training API writes under team.manage
  const [ns, setNs] = useState({ title:"", teamCode:"1XI", sessionType:"batting", date:"", time:"", durationMin:"90", venue:"Nets 1-3", notes:"" });
  const [nsSaid, setNsSaid] = useState("");

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
                  color:view===v?T.light.ink:D.textMuted,fontFamily:D.head,fontSize:"10px",fontWeight:700,
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
          {drillsLive&&drillSchools.length>0&&(
            <AddDrill schools={drillSchools} onAdded={()=>setDrillNonce(n=>n+1)}/>
          )}
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
        <Modal title="Schedule Training Session" onClose={()=>{setAddModal(false);setNsSaid("");}}>
          {drillSchools.length>1&&<Select label="School" value={ns.schoolId||""} onChange={(v)=>setNs(x=>({...x,schoolId:v}))}
            options={drillSchools.map(s=>({value:s.id,label:s.name}))}/>}
          <Input label="Session Title" value={ns.title} onChange={(v)=>setNs(x=>({...x,title:v}))} placeholder="e.g. Pre-Match Batting Practice"/>
          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
            <Select label="Team" value={ns.teamCode} onChange={(v)=>setNs(x=>({...x,teamCode:v}))} options={["1XI","U16A","U16B","U15A","U14A","U13A"]}/>
            <Select label="Type" value={ns.sessionType} onChange={(v)=>setNs(x=>({...x,sessionType:v}))} options={["batting","bowling","fielding","fitness","skills","technical"]}/>
            <Input label="Date" value={ns.date} onChange={(v)=>setNs(x=>({...x,date:v}))} type="date"/>
            <Input label="Time" value={ns.time} onChange={(v)=>setNs(x=>({...x,time:v}))} type="time"/>
            <Input label="Duration (min)" value={ns.durationMin} onChange={(v)=>setNs(x=>({...x,durationMin:v}))} type="number" placeholder="90"/>
            <Select label="Venue" value={ns.venue} onChange={(v)=>setNs(x=>({...x,venue:v}))} options={["Nets 1-3","Nets 4-5","Nets 6-7","Main Field","No.1 Ground"]}/>
          </div>
          <Input label="Notes" value={ns.notes} onChange={(v)=>setNs(x=>({...x,notes:v}))} placeholder="Session objectives and focus areas..."/>
          {nsSaid&&<div role="alert" style={{fontFamily:D.body,fontSize:"11px",color:textOn(D.rose),marginBottom:"8px"}}>{nsSaid}</div>}
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"8px"}}>
            <Btn variant="ghost" onClick={()=>{setAddModal(false);setNsSaid("");}}>Cancel</Btn>
            <Btn onClick={async ()=>{
              setNsSaid("");
              try {
                await api("/api/training", { method:"POST", body:{
                  schoolId: ns.schoolId || drillSchools[0]?.id,
                  teamCode: ns.teamCode, title: ns.title, sessionType: ns.sessionType,
                  startsAt: new Date(`${ns.date}T${ns.time || "00:00"}`).toISOString(),
                  durationMin: Number(ns.durationMin), venue: ns.venue, notes: ns.notes,
                }});
                setAddModal(false);
                setNs({ title:"", teamCode:"1XI", sessionType:"batting", date:"", time:"", durationMin:"90", venue:"Nets 1-3", notes:"" });
                setSessionNonce(x=>x+1);
              } catch (e) { setNsSaid(e.message || "Refused."); }
            }} disabled={ns.title.trim().length<3||!ns.date}>Create Session</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// One row per boy, the breaches and spikes first because the server put
// them there. The word is the server's; the colour is ours.
const LOAD_TONE = themed(() => ({ spike:D.rose, rising:D.amber, steady:D.emerald, light:D.sky, rested:D.textMuted, "no bowling":D.textMuted }));
function LoadPanel({ rows }) {
  const flagged = rows.filter(r=>r.breaches28d>0||r.loadState==="spike").length;
  // Whose clause is open. The citation is the server's (workload → db/32);
  // the screen only decides whether its text is showing.
  const [openClause, setOpenClause] = useState(null);
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
              <Fragment key={r.playerId}>
              <tr data-testid={`load-row-${r.playerId}`} style={{borderTop:`1px solid ${D.border}`}}>
                <td style={{padding:"6px 8px",color:D.textPrimary,fontWeight:600,whiteSpace:"nowrap"}}>{r.name}
                  <span style={{marginLeft:"6px",fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{r.ageBand}{r.pace&&r.maxSpell?` · ${r.maxSpell}/${r.maxDay}`:""}</span>
                  {r.clause&&<button type="button" data-testid={`load-clause-${r.playerId}`}
                    aria-expanded={openClause===r.playerId}
                    onClick={()=>setOpenClause(openClause===r.playerId?null:r.playerId)}
                    title={`${r.clause.code} — ${r.clause.title}`}
                    style={{marginLeft:"6px",padding:"1px 6px",borderRadius:D.pill,cursor:"pointer",
                      border:`1px solid ${D.border}`,background:"transparent",fontFamily:D.mono,fontSize:"9px",color:D.textSecondary}}>
                    {r.clause.code} · {r.clause.title}</button>}</td>
                <td style={{padding:"6px 8px",fontFamily:D.mono,color:D.textSecondary,whiteSpace:"nowrap"}}>{r.overs7d} · {r.overs28d} · {r.longestSpell7d}</td>
                <td style={{padding:"6px 8px",fontFamily:D.mono,color:D.textSecondary,whiteSpace:"nowrap"}}>{r.sessions7d} ({r.minutes7d}m)</td>
                <td style={{padding:"6px 8px"}}>
                  <span style={{fontFamily:D.mono,fontSize:"9px",textTransform:"uppercase",padding:"2px 7px",borderRadius:D.pill,
                    background:(LOAD_TONE[r.loadState]??D.textMuted)+"14",border:`1px solid ${(LOAD_TONE[r.loadState]??D.textMuted)}33`,color:textOn(LOAD_TONE[r.loadState]??D.textMuted)}}>{r.loadState}{r.acwr!=null?` ${r.acwr}`:""}</span>
                  {r.breaches28d>0&&<span style={{marginLeft:"6px",fontFamily:D.mono,fontSize:"9px",color:D.roseText}}>{r.breaches28d} directive breach{r.breaches28d>1?"es":""}</span>}
                </td>
              </tr>
              {r.clause&&openClause===r.playerId&&(
                <tr data-testid={`load-clause-text-${r.playerId}`}>
                  <td colSpan={4} style={{padding:"4px 8px 10px",color:D.textSecondary,lineHeight:1.5,whiteSpace:"normal"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textPrimary}}>
                      {r.clause.code} · {r.clause.title} <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,fontWeight:400}}>{r.clause.severity}</span></div>
                    <div style={{marginTop:"2px"}}>{r.clause.body}</div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// A drill the school keeps, added by whoever manages a side there. The
// platform's own drills (school NULL) are nobody's to write through the API,
// which is why this always names a school and never offers "everyone's".
function AddDrill({ schools, onAdded }) {
  const CATEGORIES = ["batting", "bowling", "fielding", "keeping", "fitness", "tactical"];
  const [open, setOpen] = useState(false);
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? "");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("batting");
  const [minutes, setMinutes] = useState("20");
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setSaid(""); setBusy(true);
    try {
      await api("/api/drills", { method: "POST", body: {
        schoolId, name: name.trim(), category, durationMin: Number(minutes),
      } });
      setName(""); setMinutes("20"); setOpen(false); onAdded();
    } catch (e) { setSaid(e.message || "Refused."); }
    finally { setBusy(false); }
  };
  if (!open) return (
    <div style={{marginBottom:"12px"}}>
      <Btn size="sm" onClick={()=>setOpen(true)}>+ Drill</Btn>
    </div>
  );
  return (
    <Card sx={{padding:"14px",marginBottom:"12px"}} data-testid="add-drill">
      <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"10px"}}>A drill for the school</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:"10px"}}>
        {schools.length>1&&<Select label="School" value={schoolId} onChange={setSchoolId}
          options={schools.map(s=>({ value:s.id, label:s.name }))}/>}
        <Input label="Name" value={name} onChange={setName} placeholder="Pavilion end yorkers"/>
        <Select label="Category" value={category} onChange={setCategory} options={CATEGORIES}/>
        <Input label="Minutes" value={minutes} onChange={setMinutes} type="number" placeholder="20"/>
      </div>
      {said&&<div role="alert" style={{fontFamily:D.body,fontSize:"11px",color:textOn(D.rose),marginBottom:"8px"}}>{said}</div>}
      <div style={{display:"flex",gap:"8px",justifyContent:"flex-end"}}>
        <Btn variant="ghost" size="sm" onClick={()=>{setOpen(false);setSaid("");}}>Cancel</Btn>
        <Btn size="sm" onClick={add} disabled={busy||name.trim().length<3||!schoolId}>Add it</Btn>
      </div>
    </Card>
  );
}

export { TrainingView };
