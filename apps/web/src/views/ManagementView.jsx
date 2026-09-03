import { useState } from "react";
import { ROLES } from "../design/roles.js";
import { D } from "../design/tokens.js";
import { can, scoped } from "../rbac/index.js";

// ══════════════════════════════════════════════════════
//  MANAGEMENT VIEW
// ══════════════════════════════════════════════════════
function ManagementView({ role, users, setUsers }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const MATCHES = scoped("matches", role);
  const PLAYERS = scoped("players", role);
  const USERS_INITIAL = scoped("users", role);
  const [activeTab, setActiveTab] = useState("users");
  const [editUser,  setEditUser]  = useState(null);   // user obj being edited
  const [addOpen,   setAddOpen]   = useState(false);
  const [delConf,   setDelConf]   = useState(null);   // id to confirm delete
  const [filterRole,setFilterRole]= useState("all");
  const [filterStatus,setFilterStatus]=useState("all");
  const [searchQ,   setSearchQ]   = useState("");
  const [newUser,   setNewUser]   = useState({name:"",email:"",role:"player",status:"active"});

  const isSuperAdmin  = role==="superadmin";
  const isAdmin       = ["superadmin","schooladmin","sportsmaster"].includes(role);
  const isGroundskeeper = role==="groundskeeper";
  const canManageUsers= isSuperAdmin;

  // Filtered users
  const filteredUsers = (users||USERS_INITIAL).filter(u=>{
    if(filterRole!=="all"&&u.role!==filterRole) return false;
    if(filterStatus!=="all"&&u.status!==filterStatus) return false;
    if(searchQ&&!u.name.toLowerCase().includes(searchQ.toLowerCase())&&!u.email.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  const saveUser = () => {
    if(editUser?.id) {
      setUsers(prev=>prev.map(u=>u.id===editUser.id?{...u,...editUser}:u));
    } else {
      const id=`u${Date.now()}`;
      setUsers(prev=>[...prev,{...newUser,id,lastLogin:"Never"}]);
    }
    setEditUser(null); setAddOpen(false);
    setNewUser({name:"",email:"",role:"player",status:"active"});
  };

  const deleteUser  = id => { setUsers(prev=>prev.filter(u=>u.id!==id)); setDelConf(null); };
  const toggleStatus= id => setUsers(prev=>prev.map(u=>u.id===id?{...u,status:u.status==="active"?"suspended":"active"}:u));
  const promoteRole = (id, newRole) => {
    if(newRole==="superadmin"&&!isSuperAdmin) return; // only SA can assign SA
    setUsers(prev=>prev.map(u=>u.id===id?{...u,role:newRole}:u));
  };

  const TABS_MAP = {
    superadmin:    [{id:"users",icon:"👥",label:"User Management",color:D.violet},{id:"squad",icon:"🏏",label:"Squad Admin",color:D.sky},{id:"fixtures",icon:"📅",label:"Fixtures",color:D.amber},{id:"broadcast",icon:"📡",label:"Broadcast",color:D.rose},{id:"audit",icon:"🔍",label:"Audit Log",color:D.textMuted}],
    schooladmin:   [{id:"users",icon:"👥",label:"Users",color:D.indigo},{id:"squad",icon:"🏏",label:"Squad Admin",color:D.sky},{id:"fixtures",icon:"📅",label:"Fixtures",color:D.amber},{id:"broadcast",icon:"📡",label:"Broadcast",color:D.rose}],
    sportsmaster:  [{id:"squad",icon:"🏏",label:"Team Management",color:D.sky},{id:"fixtures",icon:"📅",label:"Fixture Admin",color:D.amber},{id:"broadcast",icon:"📡",label:"Announcements",color:D.rose}],
    coach:         [{id:"squad",icon:"🏏",label:"Squad Tools",color:D.emerald}],
    groundskeeper: [{id:"grounds",icon:"🌿",label:"Ground Tasks",color:D.teal}],
  };
  const tabs = TABS_MAP[role]||TABS_MAP.coach;

  const AUDIT_LOG=[
    {time:"Today 09:14",user:"G. Sutherland",action:"Updated fixture — Hilton vs Michaelhouse (Sat)",type:"fixture"},
    {time:"Today 08:32",user:"C. Hendricks", action:"Added training session — Batting Nets 15:30",type:"training"},
    {time:"Yesterday",  user:"Super Admin",  action:"User u14 role changed: viewer → assistant",type:"user"},
    {time:"2d ago",     user:"B. Wessels",   action:"Match scorecard submitted — Hilton U19A vs DHS",type:"match"},
    {time:"3d ago",     user:"Dr Khumalo",   action:"Medical clearance updated — T. Pretorius",type:"medical"},
    {time:"4d ago",     user:"Super Admin",  action:"New user created — L. Dube (Coaching Asst)",type:"user"},
  ];

  const GROUND_TASKS=[
    {id:"g1",task:"Prepare Main Oval — U19A vs Michaelhouse",due:"Fri 13 Mar",priority:"high",  status:"in_progress",assignee:"E. Mzimba"},
    {id:"g2",task:"Roll and mark Practice Net 1",            due:"Thu 12 Mar",priority:"medium",status:"pending",    assignee:"S. Hadebe"},
    {id:"g3",task:"Outfield mowing — full circuit",          due:"Wed 11 Mar",priority:"low",   status:"done",       assignee:"E. Mzimba"},
    {id:"g4",task:"Pitch report — match day assessment",     due:"Fri 13 Mar",priority:"high",  status:"pending",    assignee:"E. Mzimba"},
    {id:"g5",task:"Irrigation check — all three pitches",    due:"Today",     priority:"medium",status:"done",       assignee:"S. Hadebe"},
  ];

  const priCol=p=>p==="high"?D.rose:p==="medium"?D.amber:D.textMuted;
  const statusPill=s=>({pending:{c:D.amber,l:"Pending"},in_progress:{c:D.sky,l:"In Progress"},done:{c:D.emerald,l:"Done"}}[s]||{c:D.amber,l:"Pending"});

  // ── User Edit / Add Modal ──
  const UserModal = () => {
    const u = editUser || newUser;
    const setU = editUser ? setEditUser : setNewUser;
    const availableRoles = Object.entries(ROLES).filter(([r])=>
      r!=="superadmin"||isSuperAdmin  // Only SA can set SA
    );
    return (
      <div style={{position:"fixed",inset:0,zIndex:600,background:"rgba(0,0,0,0.7)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
        <div style={{width:"100%",maxWidth:"480px",borderRadius:D.xl,border:`1px solid ${D.borderMed}`,background:D.surf1,overflow:"hidden",boxShadow:"0 24px 80px rgba(0,0,0,0.5)"}}>
          {/* Header */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 20px",borderBottom:`1px solid ${D.border}`,background:`${D.violet}08`}}>
            <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:800,color:D.textPrimary}}>{editUser?"✏️ Edit User":"➕ Add New User"}</div>
            <button onClick={()=>{setEditUser(null);setAddOpen(false);}} className="pressBtn" style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"20px"}}>×</button>
          </div>
          {/* Body */}
          <div style={{padding:"20px",display:"flex",flexDirection:"column",gap:"14px"}}>
            {/* Role chip preview */}
            {u.role&&<div style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 14px",borderRadius:D.md,background:`${ROLES[u.role]?.color||D.indigo}12`,border:`1px solid ${ROLES[u.role]?.color||D.indigo}33`}}>
              <span style={{fontSize:"16px"}}>{ROLES[u.role]?.icon}</span>
              <span style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:ROLES[u.role]?.color||D.indigo}}>{ROLES[u.role]?.label}</span>
              {u.role==="superadmin"&&<span style={{marginLeft:"auto",fontFamily:D.head,fontSize:"8px",color:D.rose}}>⚠ Highest privilege</span>}
            </div>}

            {[
              {label:"Full Name *",     key:"name",  type:"text",  placeholder:"e.g. Craig Hendricks"},
              {label:"Email Address *", key:"email", type:"email", placeholder:"email@school.co.za"},
            ].map(f=>(
              <div key={f.key}>
                <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginBottom:"5px"}}>{f.label}</div>
                <input value={u[f.key]||""} type={f.type} onChange={e=>setU(prev=>({...prev,[f.key]:e.target.value}))}
                  placeholder={f.placeholder}
                  style={{width:"100%",padding:"10px 14px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.body,fontSize:"13px",color:D.textPrimary,boxSizing:"border-box"}}/>
              </div>
            ))}

            {/* Role selector */}
            <div>
              <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginBottom:"8px"}}>Role {!isSuperAdmin&&"(Super Admin required to assign Super Admin)"}</div>
              <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"6px",maxHeight:"200px",overflowY:"auto",paddingRight:"2px"}}>
                {availableRoles.map(([r,rc])=>(
                  <button key={r} onClick={()=>setU(prev=>({...prev,role:r}))} className="pressBtn" style={{
                    display:"flex",alignItems:"center",gap:"7px",padding:"8px 10px",borderRadius:D.md,cursor:"pointer",
                    border:`1px solid ${u.role===r?rc.color+"55":D.border}`,
                    background:u.role===r?`${rc.color}18`:"transparent",textAlign:"left",
                  }}>
                    <span style={{fontSize:"14px"}}>{rc.icon}</span>
                    <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:u.role===r?rc.color:D.textMuted}}>{rc.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Status */}
            <div>
              <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginBottom:"8px"}}>Account Status</div>
              <div style={{display:"flex",gap:"8px"}}>
                {["active","suspended"].map(s=>(
                  <button key={s} onClick={()=>setU(prev=>({...prev,status:s}))} className="pressBtn" style={{
                    flex:1,padding:"8px",borderRadius:D.md,cursor:"pointer",
                    border:`1px solid ${u.status===s?(s==="active"?D.emerald:D.rose)+"66":D.border}`,
                    background:u.status===s?`${s==="active"?D.emerald:D.rose}14`:"transparent",
                    fontFamily:D.head,fontSize:"10px",fontWeight:700,textTransform:"capitalize",
                    color:u.status===s?(s==="active"?D.emerald:D.rose):D.textMuted,
                  }}>{s==="active"?"● Active":"○ Suspended"}</button>
                ))}
              </div>
            </div>
          </div>
          {/* Footer */}
          <div style={{display:"flex",gap:"10px",padding:"14px 20px",borderTop:`1px solid ${D.border}`,background:D.surf2}}>
            <button onClick={()=>{setEditUser(null);setAddOpen(false);}} className="pressBtn" style={{flex:1,padding:"10px",borderRadius:D.md,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted}}>Cancel</button>
            <button onClick={saveUser} disabled={!(u.name&&u.email)} className="pressBtn" style={{flex:2,padding:"10px",borderRadius:D.md,cursor:"pointer",background:u.name&&u.email?D.violet:"rgba(255,255,255,0.08)",border:"none",fontFamily:D.head,fontSize:"11px",fontWeight:700,color:u.name&&u.email?"#fff":"rgba(255,255,255,0.3)"}}>
              {editUser?"Save Changes":"Create User"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Delete Confirm ──
  const DeleteModal = () => {
    const u = (users||USERS_INITIAL).find(x=>x.id===delConf);
    if(!u) return null;
    return (
      <div style={{position:"fixed",inset:0,zIndex:700,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
        <div style={{width:"100%",maxWidth:"360px",borderRadius:D.xl,border:`1px solid ${D.rose}44`,background:D.surf1,padding:"24px",textAlign:"center"}}>
          <div style={{fontSize:"36px",marginBottom:"12px"}}>⚠️</div>
          <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:800,color:D.textPrimary,marginBottom:"6px"}}>Delete User?</div>
          <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,marginBottom:"20px"}}>This will permanently remove <strong style={{color:D.textSecondary}}>{u.name}</strong>. This cannot be undone.</div>
          <div style={{display:"flex",gap:"10px"}}>
            <button onClick={()=>setDelConf(null)} className="pressBtn" style={{flex:1,padding:"10px",borderRadius:D.md,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted}}>Cancel</button>
            <button onClick={()=>deleteUser(delConf)} className="pressBtn" style={{flex:1,padding:"10px",borderRadius:D.md,cursor:"pointer",background:D.rose,border:"none",fontFamily:D.head,fontSize:"11px",fontWeight:700,color:"#fff"}}>Delete</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"20px"}}>
      {(editUser||addOpen)&&canManageUsers&&<UserModal/>}
      {delConf&&canManageUsers&&<DeleteModal/>}

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:"16px",flexWrap:"wrap"}}>
        <div>
          <div style={{fontFamily:D.head,fontSize:"22px",fontWeight:800,color:D.textPrimary}}>Management Tools</div>
          <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,marginTop:"2px"}}>Role-specific admin controls · {ROLES[role]?.label}</div>
        </div>
        <div style={{marginLeft:"auto",padding:"5px 14px",borderRadius:D.pill,background:`${ROLES[role]?.color||D.indigo}18`,border:`1px solid ${ROLES[role]?.color||D.indigo}44`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:ROLES[role]?.color||D.indigo}}>
          {ROLES[role]?.icon} {ROLES[role]?.label}
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} className="pressBtn" style={{display:"flex",alignItems:"center",gap:"6px",padding:"7px 14px",borderRadius:D.pill,cursor:"pointer",border:`1px solid ${activeTab===t.id?t.color+"55":D.border}`,background:activeTab===t.id?`${t.color}18`:"transparent",fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.06em",color:activeTab===t.id?t.color:D.textMuted,transition:"all .18s"}}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── USER MANAGEMENT ── */}
      {activeTab==="users"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
          {/* Controls */}
          <div style={{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center"}}>
            {/* Search */}
            <div style={{position:"relative",flex:1,minWidth:"180px"}}>
              <span style={{position:"absolute",left:"10px",top:"50%",transform:"translateY(-50%)",fontSize:"12px",color:D.textMuted}}>🔍</span>
              <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search users…" aria-label="Search users"
                style={{width:"100%",padding:"8px 12px 8px 30px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.body,fontSize:"12px",color:D.textPrimary,boxSizing:"border-box"}}/>
            </div>
            {/* Role filter */}
            <select value={filterRole} onChange={e=>setFilterRole(e.target.value)}
              style={{padding:"7px 12px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.body,fontSize:"11px",color:D.textSecondary,cursor:"pointer"}}>
              <option value="all">All Roles</option>
              {Object.entries(ROLES).map(([r,rc])=><option key={r} value={r}>{rc.icon} {rc.label}</option>)}
            </select>
            {/* Status filter */}
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
              style={{padding:"7px 12px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.body,fontSize:"11px",color:D.textSecondary,cursor:"pointer"}}>
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
            {canManageUsers&&(
              <button onClick={()=>{setAddOpen(true);setEditUser(null);}} className="pressBtn" style={{padding:"7px 16px",borderRadius:D.pill,cursor:"pointer",background:`${D.violet}18`,border:`1px solid ${D.violet}44`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.violet,whiteSpace:"nowrap"}}>+ Add User</button>
            )}
          </div>

          {/* Stats row */}
          <div style={{display:"flex",gap:"10px",flexWrap:"wrap"}}>
            {[
              {label:"Total",value:(users||USERS_INITIAL).length,color:D.violet},
              {label:"Active",value:(users||USERS_INITIAL).filter(u=>u.status==="active").length,color:D.emerald},
              {label:"Suspended",value:(users||USERS_INITIAL).filter(u=>u.status==="suspended").length,color:D.rose},
              {label:"Showing",value:filteredUsers.length,color:D.sky},
            ].map(s=>(
              <div key={s.label} style={{padding:"10px 16px",borderRadius:D.md,background:D.surf1,border:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"8px"}}>
                <span style={{fontFamily:D.mono,fontSize:"20px",fontWeight:700,color:s.color}}>{s.value}</span>
                <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* User table */}
          <div style={{borderRadius:D.lg,border:`1px solid ${D.border}`,background:D.surf1,overflow:"hidden"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:"700px"}}>
                <thead>
                  <tr style={{background:D.surf2}}>
                    {["User","Role","Email","Status","Last Login","Actions"].map(h=>(
                      <th key={h} style={{padding:"10px 14px",textAlign:"left",fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:D.textMuted,whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length===0&&(
                    <tr><td colSpan={6} style={{padding:"24px",textAlign:"center",fontFamily:D.body,fontSize:"13px",color:D.textMuted}}>No users match the current filter.</td></tr>
                  )}
                  {filteredUsers.map((u,i)=>{
                    const rc2=ROLES[u.role]||{};
                    return(
                      <tr key={u.id} style={{borderTop:`1px solid ${D.border}`,background:i%2===0?"transparent":D.surf2+"22",opacity:u.status==="suspended"?0.55:1,transition:"opacity .2s"}}>
                        {/* User */}
                        <td style={{padding:"10px 14px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                            <div style={{width:"30px",height:"30px",borderRadius:"50%",background:`${rc2.color||D.indigo}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",flexShrink:0}}>{rc2.icon||"👤"}</div>
                            <div>
                              <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary,whiteSpace:"nowrap"}}>{u.name}</div>
                              <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>ID: {u.id}</div>
                            </div>
                          </div>
                        </td>
                        {/* Role */}
                        <td style={{padding:"10px 14px"}}>
                          {canManageUsers ? (
                            <select value={u.role} onChange={e=>promoteRole(u.id,e.target.value)}
                              style={{padding:"4px 8px",borderRadius:D.md,background:`${rc2.color||D.indigo}18`,border:`1px solid ${rc2.color||D.indigo}44`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:rc2.color||D.indigo,cursor:"pointer"}}>
                              {Object.entries(ROLES).filter(([r])=>r!=="superadmin"||isSuperAdmin).map(([r,rc])=>(
                                <option key={r} value={r}>{rc.icon} {rc.label}</option>
                              ))}
                            </select>
                          ) : (
                            <span style={{padding:"3px 9px",borderRadius:D.pill,background:`${rc2.color||D.indigo}18`,border:`1px solid ${rc2.color||D.indigo}33`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:rc2.color||D.indigo}}>
                              {rc2.icon} {rc2.label}
                            </span>
                          )}
                        </td>
                        {/* Email */}
                        <td style={{padding:"10px 14px",fontFamily:D.mono,fontSize:"11px",color:D.textMuted,maxWidth:"180px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</td>
                        {/* Status */}
                        <td style={{padding:"10px 14px"}}>
                          {canManageUsers ? (
                            <button onClick={()=>toggleStatus(u.id)} className="pressBtn" style={{padding:"3px 9px",borderRadius:D.pill,cursor:"pointer",background:u.status==="active"?`${D.emerald}18`:`${D.rose}18`,border:`1px solid ${u.status==="active"?D.emerald:D.rose}44`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:u.status==="active"?D.emerald:D.rose}}>
                              {u.status==="active"?"● Active":"○ Suspended"}
                            </button>
                          ) : (
                            <span style={{padding:"3px 9px",borderRadius:D.pill,background:u.status==="active"?`${D.emerald}18`:`${D.rose}18`,border:`1px solid ${u.status==="active"?D.emerald:D.rose}44`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:u.status==="active"?D.emerald:D.rose}}>
                              {u.status==="active"?"● Active":"○ Suspended"}
                            </span>
                          )}
                        </td>
                        {/* Last login */}
                        <td style={{padding:"10px 14px",fontFamily:D.mono,fontSize:"10px",color:D.textMuted,whiteSpace:"nowrap"}}>{u.lastLogin}</td>
                        {/* Actions */}
                        <td style={{padding:"10px 14px"}}>
                          <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                            {canManageUsers&&(
                              <>
                                <button onClick={()=>{setEditUser({...u});setAddOpen(false);}} className="pressBtn" style={{padding:"4px 10px",borderRadius:D.md,cursor:"pointer",background:D.surf3,border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textSecondary}}>✏️ Edit</button>
                                <button onClick={()=>toggleStatus(u.id)} className="pressBtn" style={{padding:"4px 10px",borderRadius:D.md,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:u.status==="active"?D.amber:D.emerald}}>
                                  {u.status==="active"?"⏸ Suspend":"▶ Restore"}
                                </button>
                                {u.role!=="superadmin"&&<button onClick={()=>setDelConf(u.id)} className="pressBtn" style={{padding:"4px 10px",borderRadius:D.md,cursor:"pointer",background:"transparent",border:`1px solid ${D.rose}44`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.rose}}>🗑</button>}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {!canManageUsers&&<div style={{padding:"12px 16px",borderRadius:D.md,background:`${D.amber}0a`,border:`1px solid ${D.amber}22`,fontFamily:D.body,fontSize:"12px",color:D.amber}}>⚠️ Only Super Admin can create, edit or delete users. Role changes require Super Admin privileges.</div>}
        </div>
      )}

      {/* ── SQUAD ADMIN ── */}
      {activeTab==="squad"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          {["U19A","U15A","U13A"].map(team=>{
            const players=PLAYERS.filter(p=>p.school==="HIL"&&p.team===team);
            return(
              <div key={team} style={{borderRadius:D.lg,border:`1px solid ${D.border}`,background:D.surf1,overflow:"hidden"}}>
                <div style={{padding:"12px 18px",borderBottom:`1px solid ${D.border}`,background:`${D.indigo}08`,display:"flex",alignItems:"center",gap:"10px"}}>
                  <span style={{fontFamily:D.head,fontSize:"12px",fontWeight:800,color:D.textPrimary}}>🏏 Hilton {team}</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>{players.length} players</span>
                  {isAdmin&&<button className="pressBtn" style={{marginLeft:"auto",padding:"4px 12px",borderRadius:D.pill,cursor:"pointer",background:`${D.indigo}18`,border:`1px solid ${D.indigo}44`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.indigo}}>+ Add Player</button>}
                </div>
                {players.map(p=>(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:"12px",padding:"8px 18px",borderBottom:`1px solid ${D.border}44`}}>
                    <div style={{width:"26px",height:"26px",borderRadius:"50%",background:`${D.indigo}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",flexShrink:0}}>{p.role==="WK"?"🧤":"🏏"}</div>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary}}>{p.name}{p.isCaptain&&<span style={{color:D.amber,fontSize:"10px",marginLeft:"6px"}}>© Cap</span>}</div>
                      <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{p.role} · Age {p.age}</div>
                    </div>
                    {p.injuryStatus&&<span style={{padding:"2px 8px",borderRadius:D.pill,background:`${D.rose}18`,border:`1px solid ${D.rose}33`,fontFamily:D.head,fontSize:"8px",fontWeight:700,color:D.rose}}>{p.injuryStatus==="injured"?"🏥 Injured":"🔄 Rehab"}</span>}
                    {isAdmin&&<button className="pressBtn" style={{padding:"3px 10px",borderRadius:D.pill,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"9px",color:D.textMuted}}>Edit</button>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* ── FIXTURES ── */}
      {activeTab==="fixtures"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"8px"}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>📅 Upcoming Fixtures</div>
            {isAdmin&&<button className="pressBtn" style={{padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",background:`${D.indigo}18`,border:`1px solid ${D.indigo}44`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.indigo}}>+ Add Fixture</button>}
          </div>
          {MATCHES.filter(m=>m.status==="upcoming").map(m=>(
            <div key={m.id} style={{borderRadius:D.lg,border:`1px solid ${D.border}`,background:D.surf1,padding:"14px 18px",display:"flex",alignItems:"center",gap:"14px",flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:"160px"}}>
                <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{m.home} vs {m.away}</div>
                <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted,marginTop:"2px"}}>{m.date} · {m.format} · {m.venue}</div>
              </div>
              <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                <span style={{padding:"3px 10px",borderRadius:D.pill,background:`${D.sky}18`,border:`1px solid ${D.sky}33`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.sky}}>{m.competition}</span>
                {isAdmin&&<button className="pressBtn" style={{padding:"3px 10px",borderRadius:D.pill,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"9px",color:D.textMuted}}>✏️ Edit</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── BROADCAST ── */}
      {activeTab==="broadcast"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          <div style={{borderRadius:D.lg,border:`1px solid ${D.rose}33`,background:`${D.rose}06`,padding:"18px 20px"}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.rose,marginBottom:"12px"}}>📡 Send Broadcast Alert</div>
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              <div>
                <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginBottom:"6px"}}>Recipients</div>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                  {["All","Players","Parents","Coaches","Staff"].map(r=>(
                    <button key={r} className="pressBtn" style={{padding:"5px 12px",borderRadius:D.pill,cursor:"pointer",background:r==="All"?`${D.rose}18`:"transparent",border:`1px solid ${r==="All"?D.rose+"55":D.border}`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:r==="All"?D.rose:D.textMuted}}>{r}</button>
                  ))}
                </div>
              </div>
              <div style={{borderRadius:D.md,border:`1px solid ${D.border}`,background:D.surf2,padding:"10px 14px",fontFamily:D.body,fontSize:"12px",color:D.textMuted,minHeight:"60px"}}>Type broadcast message here…</div>
              <button className="pressBtn" style={{alignSelf:"flex-start",padding:"8px 18px",borderRadius:D.pill,cursor:"pointer",background:D.rose,border:"none",fontFamily:D.head,fontSize:"10px",fontWeight:700,color:"#fff"}}>📡 Send Broadcast</button>
            </div>
          </div>
        </div>
      )}

      {/* ── AUDIT LOG ── */}
      {activeTab==="audit"&&isSuperAdmin&&(
        <div style={{borderRadius:D.lg,border:`1px solid ${D.border}`,background:D.surf1,overflow:"hidden"}}>
          <div style={{padding:"12px 18px",borderBottom:`1px solid ${D.border}`}}><div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>🔍 Audit Log</div></div>
          {AUDIT_LOG.map((a,i)=>{
            const tc={fixture:D.amber,training:D.emerald,user:D.violet,match:D.sky,medical:D.rose}[a.type]||D.textMuted;
            return(
              <div key={i} style={{display:"flex",alignItems:"flex-start",gap:"12px",padding:"11px 18px",borderBottom:`1px solid ${D.border}44`}}>
                <div style={{width:"8px",height:"8px",borderRadius:"50%",background:tc,marginTop:"5px",flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontFamily:D.body,fontSize:"13px",color:D.textPrimary}}>{a.action}</div>
                  <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,marginTop:"2px"}}>{a.time} · {a.user}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── GROUND TASKS ── */}
      {activeTab==="grounds"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>🌿 Ground Tasks</div>
            <button className="pressBtn" style={{padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",background:`${D.teal}18`,border:`1px solid ${D.teal}44`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.teal}}>+ New Task</button>
          </div>
          {GROUND_TASKS.map(t=>{
            const sp=statusPill(t.status);
            return(
              <div key={t.id} style={{borderRadius:D.lg,border:`1px solid ${t.priority==="high"?D.rose+"44":D.border}`,background:D.surf1,padding:"12px 18px",display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:"160px"}}>
                  <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary}}>{t.task}</div>
                  <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,marginTop:"2px"}}>Due: {t.due} · {t.assignee}</div>
                </div>
                <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                  <span style={{padding:"3px 9px",borderRadius:D.pill,background:`${priCol(t.priority)}18`,border:`1px solid ${priCol(t.priority)}33`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:priCol(t.priority),textTransform:"capitalize"}}>{t.priority}</span>
                  <span style={{padding:"3px 9px",borderRadius:D.pill,background:`${sp.c}18`,border:`1px solid ${sp.c}33`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:sp.c}}>{sp.l}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { ManagementView };
