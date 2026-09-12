
import { useEffect, useState } from "react";
import { SCHOOL } from "../data/institution.js";
import { ROLES } from "../design/roles.js";
import { D, textOn } from "../design/tokens.js";
import { SCRBRD } from "../scorer/engine.jsx";
import { Avatar, Badge, Btn, Card, EmptyState, Input, Modal, SectionHeader, Select } from "../ui/primitives.jsx";
import { useLive, useRows } from "../lib/live.js";
import { api } from "../lib/api.js";
import { disablePush, enablePush, pushSupported } from "../lib/push.js";

// ══════════════════════════════════════════════════════
//  SETTINGS VIEW — full user CRUD + RBAC + upgrades
// ══════════════════════════════════════════════════════
function SettingsView({ role, users: usersFromApp, setUsers: setUsersFromApp }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const COACHES = useRows("coaches", role);
  const PLAYERS = useRows("players", role);
  const STAFF = useRows("staff", role);
  const USERS_INITIAL = useRows("users", role);
  const [tab,       setTab]       = useState("users");
  // `useState(USERS_INITIAL)` captured the directory on the first render,
  // which is now the empty array before the read resolves — the same stale
  // copy that blanked the notifications feed. Local edits are held separately
  // so a re-fetch does not discard them.
  const [usersLocal,setUsersLocal]= useState(null);
  // Use lifted state if provided, else the server's rows, else local edits.
  const users    = usersFromApp    || usersLocal || USERS_INITIAL;
  const setUsers = setUsersFromApp || setUsersLocal;
  const [editUser,  setEditUser]  = useState(null);
  const [addUser,   setAddUser]   = useState(false);
  const [delConf,   setDelConf]   = useState(null);
  const [newUser,   setNewUser]   = useState({name:"",email:"",role:"player",player:"",staffId:"",coachId:"",status:"active"});
  const canEdit = role==="superadmin";

  const saveUser = () => {
    if (editUser) {
      setUsers(prev=>prev.map(u=>u.id===editUser.id?{...u,...editUser}:u));
    } else {
      const id = `u${Date.now()}`;
      setUsers(prev=>[...prev,{...newUser,id,lastLogin:"Never"}]);
    }
    setEditUser(null);
    setAddUser(false);
    setNewUser({name:"",email:"",role:"player",player:"",staffId:"",coachId:"",status:"active"});
  };

  const deleteUser = (id) => { setUsers(prev=>prev.filter(u=>u.id!==id)); setDelConf(null); };
  const toggleStatus = (id) => setUsers(prev=>prev.map(u=>u.id===id?{...u,status:u.status==="active"?"suspended":"active"}:u));

  const PERMS = {
    superadmin:    ["Full system access","User management","RBAC control","All 16 modules","System configuration","Audit logs"],
    schooladmin:   ["Dashboard, Competitions, Squad, Analytics","Logistics, Fields, Staff, Calendar","Notifications, Settings (limited)","No RBAC control"],
    coach:         ["Dashboard, Matches, Squad, Profiles","Skills, Training, Injuries, Analytics","Logistics, Fields, Calendar","No user management"],
    player:        ["Dashboard, Own profile","Matches (view), Fixtures","Skills (own), Training (own)","Injuries (own), Notifications"],
    parent:        ["Dashboard, Matches, Fixtures","Transport info, Notifications","Child's profile (read-only)"],
    spectator:     ["Dashboard, Live scores","Competitions (public view)","Analytics (read-only)", "Calendar"],
    scorer:        ["Dashboard, Match Centre","Scoring tools only","Calendar, Notifications"],
    medical:       ["Injuries (full CRUD)","Squad health view","Training fitness data","Profiles, Notifications"],
    driver:        ["Logistics (transport)","Matches (fixture times)","Calendar, Notifications"],
    groundskeeper: ["Fields (full CRUD)","Matches (schedule view)","Calendar, Notifications"],
  };

  const UPGRADES = [
    { id:"up1", category:"AI & Analysis",  priority:"high",  title:"AI Post-Match Report",      desc:"Auto-generate match reports using AI commentary, scorecard data and weather. Send to parents and coaches instantly.", effort:"Medium" },
    { id:"up2", category:"AI & Analysis",  priority:"high",  title:"Shot Pattern Wagon Wheel",  desc:"Import wagon-wheel data from SCRBRD scorer to show each player's scoring zones and shot tendencies.", effort:"High" },
    { id:"up3", category:"Integrations",   priority:"high",  title:"Live Score Sync (SCRBRD)",  desc:"Wire MatchCentreView to live scrbrd_v3 scorer data. Real-time wickets, overs, partnerships.", effort:"Medium" },
    { id:"up4", category:"Comms",          priority:"high",  title:"Parent Broadcast Alerts",   desc:"Push notifications to parents when their child scores a fifty, takes a wicket, or is injured.", effort:"Medium" },
    { id:"up5", category:"AI & Analysis",  priority:"medium",title:"Opposition Scouting Report",desc:"AI-generated scouting notes on upcoming opponents based on their H2H record and known squad.", effort:"Medium" },
    { id:"up6", category:"Fitness",        priority:"medium",title:"Fitness Test Logging",       desc:"Record beep tests, speed gates, vertical jump, grip strength. Track trends across the season.", effort:"Low" },
    { id:"up7", category:"Media",          priority:"medium",title:"Video Clip Tagging",         desc:"Upload short batting/bowling clips per session. Tag to player profile and link to skill gaps.", effort:"High" },
    { id:"up8", category:"Integrations",   priority:"medium",title:"CricHQ / PlayCricket Sync", desc:"Import match scorecards automatically from CricHQ or PlayCricket via API. Reduce manual entry.", effort:"High" },
    { id:"up9", category:"Comms",          priority:"medium",title:"In-App Parent Messaging",    desc:"Secure one-to-one messaging between coach and parent. Replaces WhatsApp groups.", effort:"High" },
    { id:"up10",category:"Admin",          priority:"low",   title:"PDF Scorecard Export",       desc:"One-click PDF export of any match scorecard, formatted with school branding.", effort:"Low" },
    { id:"up11",category:"Admin",          priority:"low",   title:"Season History Archive",     desc:"Year-on-year squad stats, win rates and trophies. Accessible as historical records.", effort:"Medium" },
    { id:"up12",category:"Fitness",        priority:"low",   title:"Medical Clearance Workflow", desc:"Digital RTW forms. Physio signs off, coach notified, system auto-updates injury status.", effort:"Medium" },
    { id:"up13",category:"Admin",          priority:"low",   title:"Payment & Subscription Mgmt",desc:"Track school subscription, per-student fees for transport/kit. Admin dashboard.", effort:"High" },
    { id:"up14",category:"AI & Analysis",  priority:"low",   title:"Training Recommendation Engine",desc:"AI suggests next training focus per player based on recent form, skill gaps and workload.", effort:"High" },
  ];

  const priCol = p => p==="high"?D.rose:p==="medium"?D.amber:D.sky;
  const catCol  = c => c==="AI & Analysis"?D.violet:c==="Integrations"?D.teal:c==="Comms"?D.indigo:c==="Fitness"?D.emerald:D.orange;

  return (
    <div className="os-page">
      <SectionHeader title="Settings & Access Control" sub="Users · RBAC · School config · Platform upgrades" color={D.violet}/>

      <div style={{display:"flex",gap:"6px",marginBottom:"20px",flexWrap:"wrap"}}>
        {["users","roles","alerts","clearances","passport","school","upgrades"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
            padding:"6px 18px",borderRadius:D.pill,cursor:"pointer",textTransform:"capitalize",
            border:`1px solid ${tab===t?D.violet+"55":D.border}`,background:tab===t?D.violet+"14":"transparent",
            fontFamily:D.body,fontSize:"11px",fontWeight:tab===t?700:400,color:tab===t?D.violet:D.textMuted,
          }}>{t==="upgrades"?"🚀 Upgrades":t==="alerts"?"🔔 Alerts":t==="clearances"?"🪪 My clearances":t==="passport"?"🛂 Passport":t}</button>
        ))}
      </div>

      {/* ── USERS CRUD ── */}
      {tab==="users"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px",flexWrap:"wrap",gap:"8px"}}>
            <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>{users.length} users · {users.filter(u=>u.status==="active").length} active</div>
            {canEdit&&<Btn size="sm" onClick={()=>{setAddUser(true);setEditUser(null);}}>+ Add User</Btn>}
          </div>
          <Card>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{background:D.surf2}}>
                    {["User","Role","Email","Linked To","Last Login","Status","Actions"].map(h=>(
                      <th key={h} style={{padding:"10px 12px",fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:h==="User"?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u,i)=>{
                    const rc2 = ROLES[u.role];
                    const linked = u.player
                      ? PLAYERS.find(p=>p.id===u.player)?.name
                      : u.staffId
                        ? STAFF.find(s=>s.id===u.staffId)?.name
                        : u.coachId
                          ? COACHES.find(c=>c.id===u.coachId)?.name
                          : "—";
                    return (
                      <tr key={u.id} style={{borderTop:`1px solid ${D.border}`,background:i%2===0?"transparent":D.surf2+"22",opacity:u.status==="suspended"?0.55:1}}>
                        <td style={{padding:"10px 12px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                            <Avatar name={u.name} size={30} color={rc2?.color||D.textMuted}/>
                            <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{u.name}</span>
                          </div>
                        </td>
                        <td style={{padding:"10px 12px",textAlign:"center"}}><Badge color={rc2?.color||D.textMuted}>{rc2?.icon} {rc2?.label}</Badge></td>
                        <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{u.email}</td>
                        <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{linked||"—"}</td>
                        <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{u.lastLogin}</td>
                        <td style={{padding:"10px 12px",textAlign:"center"}}><Badge color={u.status==="active"?D.emerald:D.rose}>{u.status}</Badge></td>
                        <td style={{padding:"10px 12px",textAlign:"center"}}>
                          {canEdit&&(
                            <div style={{display:"flex",gap:"4px",justifyContent:"center"}}>
                              <button onClick={()=>setEditUser({...u})} style={{background:"none",border:`1px solid ${D.border}`,borderRadius:D.sm,padding:"3px 9px",cursor:"pointer",fontFamily:D.body,fontSize:"10px",color:D.textSecondary}}>Edit</button>
                              <button onClick={()=>toggleStatus(u.id)} style={{background:"none",border:`1px solid ${u.status==="active"?D.amber+"44":D.emerald+"44"}`,borderRadius:D.sm,padding:"3px 9px",cursor:"pointer",fontFamily:D.body,fontSize:"10px",color:u.status==="active"?D.amber:D.emerald}}>{u.status==="active"?"Suspend":"Restore"}</button>
                              <button onClick={()=>setDelConf(u)} style={{background:"none",border:`1px solid ${D.rose}33`,borderRadius:D.sm,padding:"3px 9px",cursor:"pointer",fontFamily:D.body,fontSize:"10px",color:D.roseText}}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── ROLES ── */}
      {tab==="roles"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:"12px"}}>
          {Object.entries(ROLES).map(([r,rc2])=>(
            <Card key={r} sx={{padding:"16px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"12px"}}>
                <div style={{width:"38px",height:"38px",borderRadius:D.md,background:rc2.color+"18",border:`1px solid ${rc2.color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"20px"}}>{rc2.icon}</div>
                <div>
                  <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:rc2.color}}>{rc2.label}</div>
                  <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{rc2.nav.length} modules · {users.filter(u=>u.role===r).length} user{users.filter(u=>u.role===r).length!==1?"s":""}</div>
                </div>
              </div>
              {PERMS[r]?.map(p=>(
                <div key={p} style={{display:"flex",alignItems:"flex-start",gap:"7px",padding:"4px 0"}}>
                  <div style={{width:"5px",height:"5px",borderRadius:"50%",background:rc2.color,flexShrink:0,marginTop:"4px"}}/>
                  <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.4}}>{p}</span>
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}

      {/* ── SCHOOL CONFIG ── */}
      {tab==="school"&&(
        <Card sx={{padding:"20px",maxWidth:"520px"}}>
          <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginBottom:"16px"}}>School Configuration</div>
          {[["School Name",SCHOOL.name],["Abbreviation",SCHOOL.abbr],["Address",SCHOOL.address],["Province",SCHOOL.province],["Region",SCHOOL.region],["Altitude",SCHOOL.altitude],["Climate",SCHOOL.climate],["Founded",SCHOOL.founded],["Active Teams","3 (U13A, U15A, 1XI)"],["Hilton Players",PLAYERS.filter(p=>p.school==="HIL").length],["Westville Players",PLAYERS.filter(p=>p.school==="WES").length],["Staff Members",STAFF.length],["Coaches",COACHES.length],["Registered Users",users.length],["SCRBRD Version","2.2.0"],].map(([l,v])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${D.border}`,gap:"12px"}}>
              <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,flexShrink:0}}>{l}</span>
              <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textPrimary,fontWeight:500,textAlign:"right"}}>{v}</span>
            </div>
          ))}
          {canEdit&&<div style={{marginTop:"14px"}}><Btn size="sm">Edit Config</Btn></div>}
        </Card>
      )}

      {/* ── UPGRADES ── */}
      {/* ── ALERTS: this phone, and the others I have registered ── */}
      {tab==="alerts"&&<AlertsTab role={role}/>}
      {tab==="clearances"&&<MyClearancesTab role={role}/>}
      {tab==="passport"&&<PassportTab role={role}/>}

      {tab==="upgrades"&&(
        <div>
          <div style={{padding:"14px 16px",background:`linear-gradient(135deg,${D.violet}10,${D.surf2})`,borderRadius:D.lg,border:`1px solid ${D.violet}22`,marginBottom:"18px"}}>
            <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.violetText,marginBottom:"4px"}}>🚀 SCRBRD Platform Roadmap</div>
            <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,lineHeight:1.5}}>{UPGRADES.length} suggested upgrades across {[...new Set(UPGRADES.map(u=>u.category))].length} categories. Prioritised by impact.</div>
          </div>
          {["high","medium","low"].map(pri=>(
            <div key={pri} style={{marginBottom:"20px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
                <Badge color={priCol(pri)}>{pri==="high"?"🔴 High Priority":pri==="medium"?"🟡 Medium Priority":"🔵 Low Priority"}</Badge>
                <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{UPGRADES.filter(u=>u.priority===pri).length} items</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:"10px"}}>
                {UPGRADES.filter(u=>u.priority===pri).map(up=>(
                  <Card key={up.id} sx={{padding:"14px",border:`1px solid ${priCol(pri)}18`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
                      <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary,flex:1,paddingRight:"8px"}}>{up.title}</div>
                      <Badge color={catCol(up.category)}>{up.category}</Badge>
                    </div>
                    <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.5,marginBottom:"10px"}}>{up.desc}</div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Effort: <span style={{color:up.effort==="Low"?D.emerald:up.effort==="Medium"?D.amber:D.rose}}>{up.effort}</span></div>
                      <button style={{background:"none",border:`1px solid ${D.border}`,borderRadius:D.pill,padding:"3px 12px",cursor:"pointer",fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>Vote ↑</button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ADD / EDIT MODAL ── */}
      {(addUser||editUser)&&(
        <Modal title={editUser?"Edit User":"Add New User"} onClose={()=>{setAddUser(false);setEditUser(null);}}>
          <Input label="Full Name" value={editUser?editUser.name:newUser.name} onChange={e=>editUser?setEditUser(p=>({...p,name:e.target.value})):setNewUser(p=>({...p,name:e.target.value}))} placeholder="First Last"/>
          <Input label="Email" value={editUser?editUser.email:newUser.email} onChange={e=>editUser?setEditUser(p=>({...p,email:e.target.value})):setNewUser(p=>({...p,email:e.target.value}))} type="email" placeholder="user@hilton.co.za"/>
          <Select label="Role" value={editUser?editUser.role:newUser.role} onChange={v=>editUser?setEditUser(p=>({...p,role:v})):setNewUser(p=>({...p,role:v}))} options={Object.entries(ROLES).map(([v,r])=>({value:v,label:`${r.icon} ${r.label}`}))}/>
          <Select label="Linked Player (optional)" value={editUser?editUser.player||"":newUser.player} onChange={v=>editUser?setEditUser(p=>({...p,player:v||null})):setNewUser(p=>({...p,player:v}))} options={[{value:"",label:"None"},...PLAYERS.map(p=>({value:p.id,label:`${p.name} (${p.team} · ${p.school})`}))]}/>
          <Select label="Linked Coach (optional)" value={editUser?editUser.coachId||"":newUser.coachId} onChange={v=>editUser?setEditUser(p=>({...p,coachId:v||null})):setNewUser(p=>({...p,coachId:v}))} options={[{value:"",label:"None"},...COACHES.map(c=>({value:c.id,label:`${c.name} (${c.team})`}))]}/>
          <Select label="Linked Staff (optional)" value={editUser?editUser.staffId||"":newUser.staffId} onChange={v=>editUser?setEditUser(p=>({...p,staffId:v||null})):setNewUser(p=>({...p,staffId:v}))} options={[{value:"",label:"None"},...STAFF.map(s=>({value:s.id,label:`${s.name} (${s.role})`}))]}/>
          <Select label="Status" value={editUser?editUser.status:newUser.status} onChange={v=>editUser?setEditUser(p=>({...p,status:v})):setNewUser(p=>({...p,status:v}))} options={[{value:"active",label:"Active"},{value:"suspended",label:"Suspended"}]}/>
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"10px"}}>
            <Btn variant="ghost" onClick={()=>{setAddUser(false);setEditUser(null);}}>Cancel</Btn>
            <Btn onClick={saveUser}>{editUser?"Save Changes":"Create User"}</Btn>
          </div>
        </Modal>
      )}

      {/* ── DELETE CONFIRM ── */}
      {delConf&&(
        <Modal title="Delete User" onClose={()=>setDelConf(null)}>
          <p style={{fontFamily:D.body,fontSize:"13px",color:D.textSecondary,lineHeight:1.6}}>
            Are you sure you want to delete <strong style={{color:D.textPrimary}}>{delConf.name}</strong>?
            This action cannot be undone.
          </p>
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"12px"}}>
            <Btn variant="ghost" onClick={()=>setDelConf(null)}>Cancel</Btn>
            <Btn style={{background:D.rose+"18",border:`1px solid ${D.rose}33`,color:D.roseText}} onClick={()=>deleteUser(delConf.id)}>Delete User</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Turning alerts on for THIS device, and signing the others out.
 *
 * The notify path has been complete server-side for a while — the tables, the
 * fan-out that re-asks the notification's policy per person, the payload rule,
 * the delivery log — and apps/web/src/lib/push.js has been sitting there with
 * nothing importing it. A feature nobody can reach is not delivered, so this
 * is the twenty minutes that makes the other work real.
 *
 * IT DECIDES NOTHING, like the rest of the client. Registering a device can
 * only reduce what somebody receives; what they may receive is re-asked
 * server-side, as them, at send time.
 */
// What each school holds on ME and when it lapses. Read under the identity
// policy: these rows are mine, and nobody else's appear here whatever my role.
function MyClearancesTab({ role }) {
  const rows = useLive("my_clearances", role).rows;
  const tone = { missing:D.rose, expired:D.rose, revoked:D.amber, expiring:D.amber, current:D.emerald };
  return (
    <Card sx={{padding:"16px"}} data-testid="my-clearances">
      <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginBottom:"4px"}}>My clearances</div>
      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"12px"}}>
        What the school has on record that it checked, and the date it will ask again. The office records these; if one is wrong, ask them.
      </div>
      {rows.length===0
        ? <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>Nothing recorded for you.</div>
        : rows.map(r=>(
          <div key={r.id} style={{display:"flex",alignItems:"center",gap:"10px",padding:"8px 0",borderTop:`1px solid ${D.border}`}}>
            <div style={{flex:1}}>
              <div style={{fontFamily:D.body,fontSize:"12px",color:D.textPrimary,fontWeight:600}}>{r.kindLabel}</div>
              <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{r.schoolName} · issued {r.issuedOn} · {r.status==="revoked"?"revoked":`lapses ${r.expiresOn}`}</div>
            </div>
            <span style={{fontFamily:D.mono,fontSize:"9px",textTransform:"uppercase",padding:"3px 8px",borderRadius:D.pill,
                          background:tone[r.status]+"14",border:`1px solid ${tone[r.status]}33`,color:textOn(tone[r.status])}}>{r.status}</span>
          </div>
        ))}
    </Card>
  );
}

// A boy's record goes to another school only when his family names it.
// The list is what the server lets this person see — their own grants, or
// the ones naming their school — and the form is refused by the API for
// anyone who is not his family; the message below says so in its words.
function PassportTab({ role }) {
  const [nudge, setNudge] = useState(0);
  const [schools, setSchools] = useState([]);
  const [playerId, setPlayerId] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [said, setSaid] = useState("");
  const players = useRows("players", role);
  const rows = useLive("passport_consents", role, nudge).rows;
  useEffect(() => { let off = false; api("/api/schools").then((r) => { if (!off && r?.rows) setSchools(r.rows); }).catch(() => {}); return () => { off = true; }; }, []);
  const grant = async () => {
    setSaid("");
    try { await api("/api/passport/consent", { method: "POST", body: { playerId, schoolId } }); setSchoolId(""); setNudge((n) => n + 1); }
    catch (e) { setSaid(e.message || "Refused."); }
  };
  const withdraw = async (id) => {
    setSaid("");
    try { await api(`/api/passport/consent/${id}/withdraw`, { method: "POST" }); setNudge((n) => n + 1); }
    catch (e) { setSaid(e.message || "Refused."); }
  };
  const sel = {background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.sm,padding:"6px 8px",fontFamily:D.body,fontSize:"11px",color:D.textPrimary};
  return (
    <Card sx={{padding:"16px"}} data-testid="passport-tab">
      <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginBottom:"4px"}}>Passport</div>
      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"12px"}}>
        A boy's cricket record stays with his school until his family names another. Only his cricket record travels: nothing medical, no files, no notes. A family can take a name back at any time.
      </div>
      <div style={{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center",marginBottom:"12px"}}>
        <select value={playerId} onChange={(e)=>setPlayerId(e.target.value)} aria-label="Which player" style={sel}>
          <option value="">Which player?</option>
          {players.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={schoolId} onChange={(e)=>setSchoolId(e.target.value)} aria-label="Which school" style={sel}>
          <option value="">Which school?</option>
          {schools.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Btn onClick={grant} disabled={!playerId||!schoolId} >Name this school</Btn>
      </div>
      {said&&<div role="alert" style={{fontFamily:D.body,fontSize:"11px",color:textOn(D.rose),marginBottom:"8px"}}>{said}</div>}
      {rows.length===0
        ? <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>No school has been named.</div>
        : rows.map(r=>(
          <div key={r.id} data-testid={`passport-consent-${r.id}`} style={{display:"flex",alignItems:"center",gap:"10px",padding:"8px 0",borderTop:`1px solid ${D.border}`}}>
            <div style={{flex:1}}>
              <div style={{fontFamily:D.body,fontSize:"12px",color:D.textPrimary,fontWeight:600}}>{r.name} → {r.toSchoolName??"a school"}</div>
              <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>named {String(r.grantedAt).slice(0,10)}{r.withdrawnAt?` · withdrawn ${String(r.withdrawnAt).slice(0,10)}`:""}</div>
            </div>
            {r.withdrawnAt
              ? <span style={{fontFamily:D.mono,fontSize:"9px",textTransform:"uppercase",color:D.textMuted}}>withdrawn</span>
              : <Btn variant="ghost" onClick={()=>withdraw(r.id)}>Withdraw</Btn>}
          </div>
        ))}
    </Card>
  );
}

function AlertsTab({ role }) {
  const [nudge, setNudge] = useState(0);
  // useLive rather than useRows, for its third argument: turning alerts on or
  // signing a device out has to change what this table shows, and useRows
  // fetches once on mount. A first draft bumped a counter and rendered it into
  // a hidden span, which refreshed nothing and would have shown a stale list
  // after every action on this screen.
  const devices = useLive("my_devices", role, nudge).rows;
  const [support, setSupport] = useState(null);        // null = still asking
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);

  useEffect(() => { let off = false; pushSupported().then((s) => { if (!off) setSupport(s); }); return () => { off = true; }; }, []);

  // THREE DIFFERENT NOES NEED THREE DIFFERENT SENTENCES. Collapsing them into
  // "could not enable notifications" is how somebody spends ten minutes in
  // their browser settings for a deployment that simply has no VAPID key.
  const WHY = {
    unsupported:    "This browser cannot do push notifications. On an iPhone, add SCRBRD to your home screen first.",
    not_configured: "Push is not switched on for this deployment yet — nothing to do at your end.",
    declined:       "Your browser blocked notifications. You would need to allow them in its site settings.",
    no_token:       "The browser did not return a registration. Try again, or reload the page.",
  };

  const enable = async () => {
    setBusy(true); setSaid(null);
    const r = await enablePush({ label: navigator.platform || null });
    setBusy(false);
    setSaid(r.ok
      ? { ok: true,  text: "This device will now receive alerts." }
      : { ok: false, text: WHY[r.reason] ?? `Could not register this device (${r.reason}).` });
    if (r.ok) setNudge((n) => n + 1);
  };

  const disable = async () => {
    setBusy(true); setSaid(null);
    const r = await disablePush();
    setBusy(false);
    setSaid({ ok: true, text: r.retired
      ? "This device will no longer receive alerts."
      : "This device was not registered." });
    setNudge((n) => n + 1);
  };

  // Signing out one of the OTHERS, by row id rather than by token, because a
  // phone that has been lost is not the phone you are holding — and it keeps
  // receiving the school's alerts until somebody says otherwise. Bounded by
  // the table's own policy, so an id is not a capability.
  const retireOne = async (id) => {
    setBusy(true); setSaid(null);
    try {
      const r = await api("/api/devices/retire", { method: "POST", body: { id } });
      setSaid({ ok: true, text: r?.retired ? "That device has been signed out."
                                           : "That device was already signed out." });
    } catch { setSaid({ ok: false, text: "Could not sign that device out." }); }
    setBusy(false); setNudge((n) => n + 1);
  };

  const ordered = [...devices.filter((d) => d.active), ...devices.filter((d) => !d.active)];
  const when = (t) => (t ? new Date(t).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "—");
  const stateOf = (d) => d.active ? "Active"
    : d.retiredReason === "rejected" ? "Unreachable"
    : d.retiredReason === "replaced" ? "Taken over"
    : "Signed out";

  return (
    <div>
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:"12px",flexWrap:"wrap"}}>
          <div>
            <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>Alerts on this device</div>
            {/* WHAT A PUSH ACTUALLY IS, said plainly. Somebody who thinks the
                notification is the message will not open the app — and the
                notification is deliberately almost empty, because a lock
                screen is read by whoever is holding the phone. */}
            <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginTop:"5px",maxWidth:"54ch",lineHeight:1.5}}>
              A notice arrives as a prompt, not as the message itself. Open SCRBRD to read it —
              anything about a child stays behind your sign-in rather than on a lock screen.
            </div>
          </div>
          {support === null
            ? <Badge color={D.textMuted}>Checking</Badge>
            : support
              ? <div style={{display:"flex",gap:"8px",flexShrink:0}}>
                  <Btn size="sm" disabled={busy} onClick={enable}>Turn on here</Btn>
                  <Btn size="sm" variant="ghost" disabled={busy} onClick={disable}>Turn off</Btn>
                </div>
              : <Badge color={D.amber}>Not supported</Badge>}
        </div>
        {said && (
          <div style={{marginTop:"12px",padding:"9px 12px",borderRadius:D.md,fontFamily:D.body,fontSize:"11px",lineHeight:1.5,
            background:(said.ok?D.emerald:D.amber)+"12",
            border:`1px solid ${(said.ok?D.emerald:D.amber)}33`,
            color:said.ok?D.emerald:D.amber}}>{said.text}</div>
        )}
      </Card>

      <div style={{height:"16px"}}/>

      <Card>
        <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:D.textMuted,marginBottom:"10px"}}>
          My devices
        </div>
        {ordered.length === 0
          ? <EmptyState icon="📱" message="No devices registered yet. Turn alerts on above and this one will appear here."/>
          : (
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr style={{background:D.surf2}}>
                  {["Device","Registered","Last seen","State",""].map((h,i)=>(
                    <th key={h+i} style={{padding:"9px 12px",fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:i===0?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {ordered.map((d)=>(
                    <tr key={d.id} style={{borderTop:`1px solid ${D.border}`,opacity:d.active?1:0.55}}>
                      <td style={{padding:"10px 12px",fontFamily:D.body,fontSize:"12px",color:D.textPrimary}}>
                        {d.label || d.platform}
                        {/* The last six characters, never the token: it is the
                            bearer credential for pushing to that phone. */}
                        <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,marginLeft:"8px"}}>…{d.tokenTail}</span>
                      </td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"11px",color:D.textSecondary}}>{when(d.registeredAt)}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"11px",color:D.textSecondary}}>{when(d.lastSeenAt)}</td>
                      <td style={{padding:"10px 12px",textAlign:"center"}}>
                        <Badge color={d.active?D.emerald:D.textMuted}>{stateOf(d)}</Badge>
                      </td>
                      <td style={{padding:"10px 12px",textAlign:"center"}}>
                        {d.active && <Btn size="sm" variant="ghost" disabled={busy}
                          onClick={()=>retireOne(d.id)}>Sign out</Btn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {/* Retired rows are kept and shown, because "signed out on the iPad in
            March" is the answer to "why did I stop getting alerts", and a list
            of only live registrations cannot give it. */}
      </Card>
    </div>
  );
}

export { SettingsView };
