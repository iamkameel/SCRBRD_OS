
import { useEffect, useState } from "react";
import { SCHOOL } from "../data/institution.js";
import { ROLES, ROLE_FAMILIES, ROLE_IDENTITY, canonicalRole } from "../design/roles.js";
import { GRANTABLE_ROLES, ROLE_CAPABILITIES, SUBJECT_SCOPED_ROLES, TEAM_SCOPED_ROLES } from "@scrbrd/policy/roles";
import { D, textOn } from "../design/tokens.js";
import { SCRBRD } from "../scorer/engine.jsx";
import { Avatar, Badge, Btn, Card, EmptyState, Input, Modal, SectionHeader, Select } from "../ui/primitives.jsx";
import { useLive, useRows } from "../lib/live.js";
import { schoolsWhere } from "../lib/session.js";
import { holdsCapability } from "../rbac/index.js";
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
  // WHO MAY MANAGE PEOPLE, by the capability rather than by a name.
  //
  // This read `role === "superadmin"`, which is a DEMONSTRATION ALIAS. Signed
  // in against the server a role is its policy name — platformadmin,
  // schooladmin, directorofsport, principal — and none of them equal
  // "superadmin", so the Add User button and every edit, suspend and delete
  // control was hidden from everybody on the live deployment, including the
  // four roles that actually hold user.role.assign.
  //
  // The same shape of bug hid "+ Add Fixture" from the director of sport and
  // emptied the dashboard for twenty-one roles: a hardcoded demo name standing
  // in for a capability. holdsCapability() answers from the policy and works
  // for both vocabularies, because the alias resolves through the same
  // assignments the real name does.
  const canEdit = holdsCapability(role, "user.role.assign");

  // Roster people with no account, by the link the accounts read now carries.
  // Both sides are already row-scoped in Postgres for this reader, so this
  // reconciles two permitted lists rather than widening either.
  const linkedPlayerIds = new Set(users.map(u=>u.player).filter(Boolean));
  const noAccount = PLAYERS.filter(p=>!linkedPlayerIds.has(p.id));

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

  // WHAT A ROLE CAN DO, DERIVED FROM THE POLICY.
  //
  // This was a hand-written table of ten entries, and the screen rendered
  // thirty-three cards. Twenty-three of them had no detail at all — a title, a
  // module count, and nothing else — including the director of sport, the
  // principal, and every operational role in the school. Three of the ten that
  // DID have detail were written against demonstration aliases, so the real
  // roles behind them (platformadmin, guardian, facilities) showed nothing
  // while their aliases described them.
  //
  // What it said was also no longer true: "All 16 modules", "No RBAC control",
  // "Scoring tools only". A hand-written permission list is a second place for
  // authority to live and a second place for it to drift — the exact failure
  // the navigation was already rebuilt to avoid, on the one screen whose
  // subject is authority.
  //
  // So it is computed. Capabilities are grouped by their own domain prefix
  // (player.*, fixture.*, medical.*), which needs no table to maintain and
  // cannot disagree with what the database enforces.
  const DOMAIN_LABEL = {
    player:"Players", fixture:"Fixtures", team:"Teams", scoring:"Scoring",
    medical:"Medical", clearance:"Clearances", transport:"Transport",
    facility:"Grounds", competition:"Competitions", news:"News",
    sponsorship:"Sponsorship", invoice:"Finance", user:"People",
    school:"School", platform:"Platform", analytics:"Analytics",
    opposition:"Opposition", scouting:"Scouting", officiating:"Officials",
    recognition:"Recognition", discipline:"Discipline", availability:"Availability",
    audit:"Audit", broadcast:"Broadcast", guardian:"Guardians",
  };
  const capsOf = (r) => [...(ROLE_CAPABILITIES[r] ?? [])];
  const domainsOf = (r) => {
    const by = {};
    for (const c of capsOf(r)) {
      const d = c.split(".")[0];
      (by[d] ??= []).push(c);
    }
    // Widest domain first: what a role mostly does should read first.
    return Object.entries(by).sort((a, b) => b[1].length - a[1].length);
  };
  // The roles THIS person may actually grant, from the policy's own table.
  // The picker offered Object.entries(ROLES) — the lookup table — so it listed
  // thirty-three options with nine duplicate names, and every role in the
  // product regardless of whether the person filling the form could confer it.
  // Choosing one the server then refuses is a form that wastes an
  // administrator's time to tell them something the policy already knew.
  const grantable = GRANTABLE_ROLES[canonicalRole(role)] ?? [];

  // The two shape rules the database enforces on an assignment, said plainly.
  const scopeNote = (r) =>
    TEAM_SCOPED_ROLES.includes(r) ? "Must name a team"
    : SUBJECT_SCOPED_ROLES.includes(r) ? "Must name a person"
    : ROLE_IDENTITY[r]?.family === "platform" ? "Platform-wide, no school"
    : "Scoped to a school";

  // THE ROADMAP, AGAINST WHAT IS ACTUALLY BUILT.
  //
  // This list described a product with no backend. Four of its items had since
  // shipped and still read as proposals — a roadmap that cannot tell a built
  // thing from a wished-for one is worse than no roadmap, because somebody
  // plans around it.
  //
  // `status` is therefore checked against the repository, not asserted:
  //   shipped  — built, and covered by a walk that would fail if it broke
  //   partial  — the DATA exists and is permission-scoped; no screen draws it
  //   planned  — not started
  //
  // "partial" is the honest and uncomfortable category, and it is where most of
  // the value now sits: thirty-three of the read endpoints are computed, tested
  // and never rendered.
  const UPGRADES = [
    // ── Shipped ──────────────────────────────────────────────────
    { id:"up2", category:"AI & Analysis", priority:"high", status:"shipped",
      title:"Shot Pattern Wagon Wheel",
      desc:"A boy's scoring zones across every innings, on his own profile. Placements are stored batter-relative and mirrored at render, so a left-hander's cover drive is comparable with a right-hander's.", effort:"High" },
    { id:"up3", category:"Integrations", priority:"high", status:"shipped",
      title:"Live Score Sync",
      desc:"Match Centre reads the live fold from the ball log. Offline queue, device handover and voided balls all covered.", effort:"Medium" },
    { id:"up4", category:"Comms", priority:"high", status:"shipped",
      title:"Parent Broadcast Alerts",
      desc:"Push to a registered device when something happens to their child. Delivery is per-person and permission-scoped, so a notice reaches the family and nobody else.", effort:"Medium" },
    { id:"up12", category:"Fitness", priority:"medium", status:"shipped",
      title:"Medical Clearance Workflow",
      desc:"Clearance requirements, adult clearances and a register a school can actually be audited against.", effort:"Medium" },

    // ── Built underneath, not yet drawn ──────────────────────────
    { id:"up5", category:"AI & Analysis", priority:"high", status:"partial",
      title:"Opposition Dossier",
      desc:"Batter-against-bowler match-ups, the derby record and the opponent's squad are all computed and permission-scoped. Nothing on screen reads them yet — this is the largest single gap in the product.", effort:"Medium" },
    { id:"up15", category:"Fitness", priority:"high", status:"partial",
      title:"Bowling Workload & Welfare",
      desc:"Spells, breaches and directives against age-group limits are modelled and tested. A coach cannot see them. This is a duty-of-care feature, not an analytics one.", effort:"Low" },
    { id:"up16", category:"Admin", priority:"medium", status:"partial",
      title:"Caps, Honours & Milestones on the Passport",
      desc:"Recorded, consented and readable; simply not shown. The cheapest item here and the one a pupil actually opens.", effort:"Low" },
    { id:"up11", category:"Admin", priority:"low", status:"partial",
      title:"Season History Archive",
      desc:"Seasons and competitions are modelled; there is no year-on-year view over them.", effort:"Medium" },

    // ── Planned ──────────────────────────────────────────────────
    { id:"up17", category:"AI & Analysis", priority:"high", status:"planned",
      title:"Match Insights & Intelligence Ribbon",
      desc:"An insight anchored to the delivery that caused it, typed so it can be ranked rather than cycled, and carrying whether a machine derived it or a scorer confirmed it.", effort:"Medium" },
    { id:"up18", category:"AI & Analysis", priority:"medium", status:"planned",
      title:"Pitch Map",
      desc:"Line and length per delivery — the bowling half of the wagon wheel. The only chart form genuinely missing.", effort:"Medium" },
    { id:"up1", category:"AI & Analysis", priority:"medium", status:"planned",
      title:"Post-Match Report",
      desc:"A written report from the scorecard, the phases and the conditions. Should say which of it was derived and which asserted.", effort:"Medium" },
    { id:"up6", category:"Fitness", priority:"medium", status:"planned",
      title:"Fitness Test Logging",
      desc:"Beep tests, speed gates, vertical jump, grip strength, tracked across a season.", effort:"Low" },
    { id:"up7", category:"Media", priority:"medium", status:"planned",
      title:"Video & Photo Clips",
      desc:"No media is modelled at all today. For a product whose users are fifteen-year-olds, that is a real absence.", effort:"High" },
    { id:"up9", category:"Comms", priority:"medium", status:"planned",
      title:"In-App Parent Messaging",
      desc:"Secure one-to-one between coach and parent, replacing the WhatsApp group. Nothing is modelled yet.", effort:"High" },
    { id:"up13", category:"Admin", priority:"medium", status:"planned",
      title:"Invoicing & Subscriptions",
      desc:"Note: invoice.read and invoice.manage are already granted to the principal and the bursar, with no table behind them. The finance role currently cannot do the thing its name describes.", effort:"High" },
    { id:"up8", category:"Integrations", priority:"low", status:"planned",
      title:"CricHQ / PlayCricket Import",
      desc:"CSV import exists and goes through the ordinary write policies. A direct API sync does not.", effort:"High" },
    { id:"up10", category:"Admin", priority:"low", status:"planned",
      title:"PDF Scorecard Export",
      desc:"One-click export of any scorecard with the school's branding.", effort:"Low" },
    { id:"up14", category:"AI & Analysis", priority:"low", status:"planned",
      title:"Training Recommendation Engine",
      desc:"Next focus per player from recent form, skill gaps and workload. Wants the workload screen above to exist first.", effort:"High" },
  ];
  const STATUS_TONE  = { shipped:D.emerald, partial:D.amber, planned:D.textMuted };
  const STATUS_LABEL = { shipped:"Shipped", partial:"Built, not drawn", planned:"Planned" };

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

          {/* THE PEOPLE WITH NO ACCOUNT.
              This screen listed accounts, so a boy on the roster who cannot
              sign in simply was not here — and "R Pillay has no account" is an
              access-control fact, not an absence. It is the answer to "why
              can't he see his own passport", and it was unobtainable from the
              one screen whose job is access.
              Two scoped reads, reconciled: the roster this person may read,
              minus the accounts they may read. Neither widens the other. */}
          {noAccount.length>0&&(
            <Card sx={{padding:"14px",marginBottom:"14px",borderLeft:`3px solid ${D.amber}`}} data-testid="people-without-accounts">
              <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"4px"}}>
                On a roster, no account — {noAccount.length} of {PLAYERS.length}
              </div>
              <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"10px",lineHeight:1.5}}>
                These people appear in Squad and Profiles and hold a passport, but cannot sign in.
                An account is what links the two: without one, nobody can read their own record.
              </div>
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                {noAccount.map(p=>(
                  <span key={p.id} data-testid={`no-account-${p.id}`} style={{display:"inline-flex",alignItems:"center",gap:"6px",
                    padding:"4px 10px",borderRadius:D.pill,background:D.amber+"14",border:`1px solid ${D.amber}33`,
                    fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>
                    <Avatar name={p.name} size={18} color={D.amber}/>
                    {p.name}
                    <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{p.team}</span>
                  </span>
                ))}
              </div>
            </Card>
          )}
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
        <div data-testid="roles-tab">
          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginBottom:"14px",lineHeight:1.5,maxWidth:"70ch"}}>
            Every role the authorization model knows about, grouped by family.
            What each one can do is read from the policy that generates the
            database's row-level security — not described alongside it.
          </div>
          {/* ROLE_FAMILIES, not ROLES: the latter is the lookup table, and it
              carries nine demonstration aliases that render as duplicate cards
              under their target's own name. */}
          {Object.entries(ROLE_FAMILIES).map(([family,members])=>(
            <div key={family} style={{marginBottom:"18px"}}>
              <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:D.textMuted,marginBottom:"8px"}}>{family}</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:"12px"}}>
                {members.map(r=>{
                  const rc2 = ROLES[r];
                  const doms = domainsOf(r);
                  const n = capsOf(r).length;
                  const held = users.filter(u=>u.role===r).length;
                  return (
                    <Card key={r} sx={{padding:"16px"}} data-testid={`role-card-${r}`}>
                      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
                        <div style={{width:"38px",height:"38px",borderRadius:D.md,background:rc2.color+"18",border:`1px solid ${rc2.color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"20px"}}>{rc2.icon}</div>
                        <div style={{minWidth:0}}>
                          <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:rc2.color}}>{rc2.label}</div>
                          <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>
                            {n} capabilit{n===1?"y":"ies"} · {rc2.nav.length} screens · {held} account{held===1?"":"s"}
                          </div>
                        </div>
                      </div>

                      <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginBottom:"9px",letterSpacing:"0.04em"}}>
                        {scopeNote(r)}
                      </div>

                      {doms.length===0
                        ? <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>No capabilities.</div>
                        : doms.map(([dom,list])=>(
                            <div key={dom} style={{display:"flex",alignItems:"flex-start",gap:"7px",padding:"3px 0"}}>
                              <div style={{width:"5px",height:"5px",borderRadius:"50%",background:rc2.color,flexShrink:0,marginTop:"5px"}}/>
                              <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.4}}>
                                {DOMAIN_LABEL[dom] ?? dom}
                                <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}> · {list.length}</span>
                                {/* The capabilities themselves, for anyone who
                                    needs the exact answer rather than the shape. */}
                                <span title={list.join("\n")} style={{cursor:"help",color:D.textMuted}}> ⓘ</span>
                              </span>
                            </div>
                          ))}
                    </Card>
                  );
                })}
              </div>
            </div>
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

      {tab==="school"&&<OpenCeiling/>}

      {/* ── UPGRADES ── */}
      {/* ── ALERTS: this phone, and the others I have registered ── */}
      {tab==="alerts"&&<AlertsTab role={role}/>}
      {tab==="clearances"&&<MyClearancesTab role={role}/>}
      {tab==="passport"&&<PassportTab role={role}/>}

      {tab==="upgrades"&&(
        <div>
          <div style={{padding:"14px 16px",background:`linear-gradient(135deg,${D.violet}10,${D.surf2})`,borderRadius:D.lg,border:`1px solid ${D.violet}22`,marginBottom:"18px"}}>
            <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.violetText,marginBottom:"4px"}}>🚀 SCRBRD Platform Roadmap</div>
            <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,lineHeight:1.5}}>
              {["shipped","partial","planned"].map(s=>`${UPGRADES.filter(u=>u.status===s).length} ${STATUS_LABEL[s].toLowerCase()}`).join(" · ")}.
              Status is checked against the codebase, not declared.
            </div>
          </div>

          {/* Grouped by STATUS rather than priority.
              Priority is an opinion and every item claimed one; status is a
              fact, and it was the missing column — four of these had shipped
              and still read as proposals. Priority survives as a tint on the
              card, where it belongs. */}
          {["shipped","partial","planned"].map(st=>(
            <div key={st} style={{marginBottom:"20px"}} data-testid={`roadmap-${st}`}>
              <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
                <Badge color={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge>
                <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{UPGRADES.filter(u=>u.status===st).length} items</span>
                {st==="partial"&&<span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>
                  — the data is built and permission-scoped; no screen reads it yet
                </span>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:"10px"}}>
                {UPGRADES.filter(u=>u.status===st).map(up=>(
                  <Card key={up.id} sx={{padding:"14px",border:`1px solid ${STATUS_TONE[st]}22`,
                                         borderLeft:`3px solid ${priCol(up.priority)}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
                      <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary,flex:1,paddingRight:"8px"}}>{up.title}</div>
                      <Badge color={catCol(up.category)}>{up.category}</Badge>
                    </div>
                    <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.5,marginBottom:"10px"}}>{up.desc}</div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
                      <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>
                        {up.priority} priority · effort <span style={{color:up.effort==="Low"?D.emerald:up.effort==="Medium"?D.amber:textOn(D.rose)}}>{up.effort}</span>
                      </div>
                      {/* The "Vote ↑" button that stood here did nothing at all:
                          no handler, no state, no endpoint. A control that
                          looks live and is not teaches people the whole screen
                          is decorative. Voting needs somewhere to record a
                          vote; until that exists, the status is the useful
                          thing to show. */}
                      <span style={{fontFamily:D.mono,fontSize:"10px",color:STATUS_TONE[st]}}>{STATUS_LABEL[st]}</span>
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
          <Select label="Role" value={editUser?editUser.role:newUser.role} onChange={v=>editUser?setEditUser(p=>({...p,role:v})):setNewUser(p=>({...p,role:v}))} options={grantable.map(v=>({value:v,label:`${ROLES[v].icon} ${ROLES[v].label}`}))}/>
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

// THE OPEN BAND'S CEILING. The platform's directive limits a pace bowler by
// age band and leaves Open alone: U17 and U18 play Open at school level, and
// an Open club side may field grown men. A high school may still put its own
// line under its schoolboys, and this is where it says so.
//
// Only a school may have one — the table's own trigger refuses any other kind
// of tenant outright — so this is drawn for the schools this person's roles
// could set it for, and the server refuses the write regardless.
function OpenCeiling() {
  const schools = schoolsWhere("player.workload.manage");
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? "");
  const [spell, setSpell] = useState("");
  const [day, setDay] = useState("");
  const [said, setSaid] = useState("");
  const [done, setDone] = useState("");
  if (schools.length === 0) return null;
  const save = async () => {
    setSaid(""); setDone("");
    try {
      const r = await api("/api/bowling-ceiling", { method: "POST", body: {
        schoolId,
        maxOversPerSpell: spell === "" ? null : Number(spell),
        maxOversPerDay: day === "" ? null : Number(day),
      } });
      setDone(`Set: ${r.maxOversPerSpell ?? "no"} per spell, ${r.maxOversPerDay ?? "no"} per day.`);
    } catch (e) { setSaid(e.message || "Refused."); }
  };
  return (
    <Card sx={{padding:"20px",maxWidth:"520px",marginTop:"12px"}} data-testid="open-ceiling">
      <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginBottom:"4px"}}>Open-band bowling ceiling</div>
      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"14px"}}>
        The junior directives cap a pace bowler by age band. Open carries none, because U17 and U18 play Open division.
        A school may put its own line under them anyway. Leave a field empty to set no limit of that kind.
      </div>
      {schools.length>1&&<Select label="School" value={schoolId} onChange={setSchoolId}
        options={schools.map(s=>({ value:s.id, label:s.name }))}/>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
        <Input label="Overs per spell" value={spell} onChange={setSpell} type="number" placeholder="e.g. 7"/>
        <Input label="Overs per day" value={day} onChange={setDay} type="number" placeholder="e.g. 18"/>
      </div>
      {said&&<div role="alert" style={{fontFamily:D.body,fontSize:"11px",color:textOn(D.rose),marginBottom:"8px"}}>{said}</div>}
      {done&&<div style={{fontFamily:D.body,fontSize:"11px",color:textOn(D.emerald),marginBottom:"8px"}}>{done}</div>}
      <Btn size="sm" onClick={save} disabled={!schoolId||(spell===""&&day==="")}>Set the ceiling</Btn>
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
