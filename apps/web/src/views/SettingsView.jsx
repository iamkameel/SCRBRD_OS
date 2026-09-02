import { useState } from "react";
import { SCHOOL } from "../data/institution.js";
import { COACHES, PLAYERS, STAFF, USERS_INITIAL } from "../data/mock.js";
import { ROLES } from "../design/roles.js";
import { D } from "../design/tokens.js";
import { SCRBRD } from "../scorer/engine.jsx";
import { Avatar, Badge, Btn, Card, Input, Modal, SectionHeader, Select } from "../ui/primitives.jsx";

// ══════════════════════════════════════════════════════
//  SETTINGS VIEW — full user CRUD + RBAC + upgrades
// ══════════════════════════════════════════════════════
function SettingsView({ role, users: usersFromApp, setUsers: setUsersFromApp }) {
  const [tab,       setTab]       = useState("users");
  const [usersLocal,setUsersLocal]= useState(USERS_INITIAL);
  // Use lifted state if provided, else local fallback
  const users    = usersFromApp    || usersLocal;
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
        {["users","roles","school","upgrades"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
            padding:"6px 18px",borderRadius:D.pill,cursor:"pointer",textTransform:"capitalize",
            border:`1px solid ${tab===t?D.violet+"55":D.border}`,background:tab===t?D.violet+"14":"transparent",
            fontFamily:D.body,fontSize:"11px",fontWeight:tab===t?700:400,color:tab===t?D.violet:D.textMuted,
          }}>{t==="upgrades"?"🚀 Upgrades":t}</button>
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
                              <button onClick={()=>setDelConf(u)} style={{background:"none",border:`1px solid ${D.rose}33`,borderRadius:D.sm,padding:"3px 9px",cursor:"pointer",fontFamily:D.body,fontSize:"10px",color:D.rose}}>Delete</button>
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
          {[["School Name",SCHOOL.name],["Abbreviation",SCHOOL.abbr],["Address",SCHOOL.address],["Province",SCHOOL.province],["Region",SCHOOL.region],["Altitude",SCHOOL.altitude],["Climate",SCHOOL.climate],["Founded",SCHOOL.founded],["Active Teams","3 (U13A, U15A, U19A)"],["Hilton Players",PLAYERS.filter(p=>p.school==="HIL").length],["Westville Players",PLAYERS.filter(p=>p.school==="WES").length],["Staff Members",STAFF.length],["Coaches",COACHES.length],["Registered Users",users.length],["SCRBRD Version","2.2.0"],].map(([l,v])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${D.border}`,gap:"12px"}}>
              <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,flexShrink:0}}>{l}</span>
              <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textPrimary,fontWeight:500,textAlign:"right"}}>{v}</span>
            </div>
          ))}
          {canEdit&&<div style={{marginTop:"14px"}}><Btn size="sm">Edit Config</Btn></div>}
        </Card>
      )}

      {/* ── UPGRADES ── */}
      {tab==="upgrades"&&(
        <div>
          <div style={{padding:"14px 16px",background:`linear-gradient(135deg,${D.violet}10,${D.surf2})`,borderRadius:D.lg,border:`1px solid ${D.violet}22`,marginBottom:"18px"}}>
            <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.violet,marginBottom:"4px"}}>🚀 SCRBRD Platform Roadmap</div>
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
            <Btn style={{background:D.rose+"18",border:`1px solid ${D.rose}33`,color:D.rose}} onClick={()=>deleteUser(delConf.id)}>Delete User</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

export { SettingsView };
