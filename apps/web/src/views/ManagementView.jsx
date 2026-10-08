import { useEffect, useState } from "react";
import { ROLES } from "../design/roles.js";
import { D, inkOn, textOn } from "../design/tokens.js";
import { holdsCapability } from "../rbac/index.js";
import { useLive, useRows } from "../lib/live.js";
import { api, signedIn } from "../lib/api.js";
import { humanDate } from "../lib/format.js";
import { decideWords, decidedWords } from "../lib/decideWords.js";
import { Icon } from "../ui/icons.jsx";
import { PeoplePanel } from "./people.jsx";

// ══════════════════════════════════════════════════════
//  MANAGEMENT VIEW
//
//  The Users tab is the real directory (views/people.jsx): every person with
//  every role they hold, and Add user / Add role saved through POST /api/users.
//  It reads its own rows, so this view no longer takes the app's lifted
//  `users` or a setter for them; `onDirectoryChanged` tells the app to re-read
//  its copy (which Settings still draws from) after a write.
// ══════════════════════════════════════════════════════
function ManagementView({ role, onDirectoryChanged }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const MATCHES = useRows("matches", role);
  const PLAYERS = useRows("players", role);
  const [activeTab, setActiveTab] = useState(null);

  // WHAT THIS ROLE HOLDS, never what it is called. The server decides again on
  // every write; these decide what to draw. (The buttons on the Squad and
  // Fixtures tabs below are still the prototype's: they change nothing.)
  const canEditPlayers  = holdsCapability(role,"player.profile.manage");
  const canAddFixtures  = holdsCapability(role,"fixture.create");
  const canEditFixtures = holdsCapability(role,"fixture.update");

  // THE TABS A PERSON HAS ARE THE CAPABILITIES THEY HOLD. This was a table
  // keyed by role name, which gave a principal — who may assign roles — the
  // coach's one tab, and a director of sport no Users tab at all. Each tab
  // names the capability that opens it and the order is the screen's.
  const TABS = [
    {id:"users",    cap:"user.role.assign",  icon:"users",       label:"Users",        color:D.indigoText},
    {id:"squad",    cap:"team.manage",       icon:"bat",         label:"Squad",        color:D.sky},
    {id:"fixtures", cap:"fixture.create",    icon:"calendar",    label:"Fixtures",     color:D.amber},
    {id:"broadcast",cap:"broadcast.publish", icon:"radio-tower", label:"Broadcast",    color:D.roseText},
    {id:"audit",    cap:"audit.read",        icon:"search",      label:"Audit log",    color:D.textSecondary},
    {id:"grounds",  cap:"facility.manage",   icon:"ground",      label:"Ground tasks", color:D.teal},
  ];
  const tabs = TABS.filter(t=>holdsCapability(role,t.cap));
  // The screen opens on the first tab this person has.
  const tab = tabs.some(t=>t.id===activeTab) ? activeTab : tabs[0]?.id;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"20px"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:"16px",flexWrap:"wrap"}}>
        <div>
          <div style={{fontFamily:D.head,fontSize:"22px",fontWeight:800,color:D.textPrimary}}>Management Tools</div>
          <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,marginTop:"2px"}}>Role-specific admin controls · {ROLES[role]?.label}</div>
        </div>
        <div style={{marginLeft:"auto",padding:"5px 14px",borderRadius:D.pill,background:`${ROLES[role]?.color||D.indigo}18`,border:`1px solid ${ROLES[role]?.color||D.indigo}44`,fontFamily:D.head,fontSize:"12px",fontWeight:700,color:ROLES[role]?.color||D.indigo}}>
          <Icon name={ROLES[role]?.icon}/> {ROLES[role]?.label}
        </div>
      </div>

      {/* Tabs */}
      {tabs.length===0&&<div data-testid="mgmt-nothing" style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted}}>Nothing on this screen is yours to manage.</div>}
      <div role="group" aria-label="Management sections" style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} aria-pressed={tab===t.id} className="pressBtn" data-testid={`mgmt-tab-${t.id}`} style={{display:"flex",alignItems:"center",gap:"6px",minHeight:"44px",padding:"7px 16px",borderRadius:D.pill,cursor:"pointer",border:`1px solid ${tab===t.id?t.color+"55":D.border}`,background:tab===t.id?`${t.color}18`:"transparent",fontFamily:D.head,fontSize:"13px",fontWeight:700,letterSpacing:"0.02em",color:tab===t.id?t.color:D.textMuted,transition:"all .18s"}}>
            <Icon name={t.icon}/> {t.label}
          </button>
        ))}
      </div>

      {/* ── USER MANAGEMENT ── the real directory: views/people.jsx */}
      {tab==="users"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
          <RequestsPanel role={role} players={PLAYERS}/>
          <PeoplePanel role={role} players={PLAYERS} onDirectoryChanged={onDirectoryChanged}/>
        </div>
      )}

      {/* ── SQUAD ADMIN ── */}
      {tab==="squad"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          {["1XI","U15A","U13A"].map(team=>{
            const players=PLAYERS.filter(p=>p.school==="HIL"&&p.team===team);
            return(
              <div key={team} style={{borderRadius:D.lg,border:`1px solid ${D.border}`,background:D.surf1,overflow:"hidden"}}>
                <div style={{padding:"12px 18px",borderBottom:`1px solid ${D.border}`,background:`${D.indigo}08`,display:"flex",alignItems:"center",gap:"10px"}}>
                  <span style={{fontFamily:D.head,fontSize:"12px",fontWeight:800,color:D.textPrimary}}><Icon name="bat"/> Hilton {team}</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>{players.length} players</span>
                  {canEditPlayers&&<button className="pressBtn" style={{marginLeft:"auto",padding:"4px 12px",borderRadius:D.pill,cursor:"pointer",background:`${D.indigo}18`,border:`1px solid ${D.indigo}44`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.indigoText}}>+ Add Player</button>}
                </div>
                {players.map(p=>(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:"12px",padding:"8px 18px",borderBottom:`1px solid ${D.border}44`}}>
                    <div style={{width:"26px",height:"26px",borderRadius:"50%",background:`${D.indigo}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",flexShrink:0,color:D.indigoText}}><Icon name={p.role==="WK"?"gloves":"bat"}/></div>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary}}>{p.name}{p.isCaptain&&<span style={{color:D.amber,fontSize:"10px",marginLeft:"6px"}}>© Cap</span>}</div>
                      <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{p.role} · Age {p.age}</div>
                    </div>
                    {p.injuryStatus&&<span style={{padding:"2px 8px",borderRadius:D.pill,background:`${D.rose}18`,border:`1px solid ${D.rose}33`,fontFamily:D.head,fontSize:"8px",fontWeight:700,color:D.roseText}}>{p.injuryStatus==="injured"?<><Icon name="bandage"/> Injured</>:<><Icon name="rotate-ccw"/> Rehab</>}</span>}
                    {canEditPlayers&&<button className="pressBtn" style={{padding:"3px 10px",borderRadius:D.pill,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"9px",color:D.textMuted}}>Edit</button>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* ── FIXTURES ── */}
      {tab==="fixtures"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"8px"}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}><Icon name="calendar"/> Upcoming Fixtures</div>
            {canAddFixtures&&<button className="pressBtn" style={{padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",background:`${D.indigo}18`,border:`1px solid ${D.indigo}44`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.indigoText}}>+ Add Fixture</button>}
          </div>
          {MATCHES.filter(m=>m.status==="upcoming").map(m=>(
            <div key={m.id} style={{borderRadius:D.lg,border:`1px solid ${D.border}`,background:D.surf1,padding:"14px 18px",display:"flex",alignItems:"center",gap:"14px",flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:"160px"}}>
                <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{m.home} vs {m.away}</div>
                <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted,marginTop:"2px"}}>{m.date} · {m.format} · {m.venue}</div>
              </div>
              <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                <span style={{padding:"3px 10px",borderRadius:D.pill,background:`${D.sky}18`,border:`1px solid ${D.sky}33`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.sky}}>{m.competition}</span>
                {canEditFixtures&&<button className="pressBtn" style={{padding:"3px 10px",borderRadius:D.pill,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"9px",color:D.textMuted}}><Icon name="pencil"/> Edit</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── BROADCAST ── */}
      {tab==="broadcast"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          <div style={{borderRadius:D.lg,border:`1px solid ${D.rose}33`,background:`${D.rose}06`,padding:"18px 20px"}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.roseText,marginBottom:"12px"}}><Icon name="radio-tower"/> Send Broadcast Alert</div>
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
              <button className="pressBtn" style={{alignSelf:"flex-start",padding:"8px 18px",borderRadius:D.pill,cursor:"pointer",background:D.rose,border:"none",fontFamily:D.head,fontSize:"10px",fontWeight:700,color:inkOn(D.rose)}}><Icon name="radio-tower"/> Send Broadcast</button>
            </div>
          </div>
        </div>
      )}

      {/* ── AUDIT LOG ── the real one (db/79): audit_log(), under audit.read */}
      {tab==="audit"&&<AuditLog/>}

      {/* ── GROUND TASKS ── the duties are the fixtures at this person's grounds */}
      {tab==="grounds"&&<GroundDuties role={role}/>}
    </div>
  );
}

// THE AUDIT LOG (SCRBRD-132 B2, db/79; roles granted, db/80). Who did what, newest first, from the
// school's audit tables, read through audit_log(): each table only under its
// own audit.read predicate, never a safeguarding row, never a reason or a
// note, a child's name in initials — and every read of it, this one included,
// is itself on the log. The server decides all of that; this draws it, with a
// filter by kind and by date, and a page at a time (the cursor is the last
// row's instant and key, so the reads the log appends while somebody pages
// do not repeat a row). The demonstration has no log to read and says so.
const AUDIT_KINDS = [
  ["access",    "Reads"],
  ["role",      "Roles granted and ended"],
  ["support",   "Support sessions"],
  ["scoring",   "Scoring pen"],
  ["amendment", "Amendments"],
  ["scorebook", "Scorebook imports"],
  ["duty",      "Duty suspensions"],
];
const AUDIT_PAGE = 25;
// A row with nobody behind it. A grant made by a seed or a migration has no
// created_by (db/80): the system made it. Anything else without an actor was
// somebody whose account is gone.
const auditActor = (r) => r.actor ?? (r.kind === "role" && String(r.key).endsWith(":granted") ? "The system" : "Somebody no longer on the system");
const auditWhen = (at) => {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

function AuditLog() {
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [state, setState] = useState({ rows: [], loading: true, error: null, more: false });
  const [nonce, setNonce] = useState(0);
  const live = signedIn();

  const query = (cursor) => {
    const p = new URLSearchParams({ limit: String(AUDIT_PAGE) });
    if (kind) p.set("kinds", kind);
    if (from) p.set("since", new Date(`${from}T00:00:00+02:00`).toISOString());
    if (cursor) { p.set("before", cursor.at); p.set("beforeKey", cursor.key); }
    else if (to) p.set("before", new Date(new Date(`${to}T00:00:00+02:00`).getTime() + 86400000).toISOString());
    return `/api/read/audit_log?${p.toString()}`;
  };

  // Every hook above any return: the hook count must not change between renders.
  useEffect(() => {
    if (!live) return undefined;
    let cancelled = false;
    setState({ rows: [], loading: true, error: null, more: false });
    api(query(null))
      .then(({ rows }) => { if (!cancelled) setState({ rows, loading: false, error: null, more: rows.length === AUDIT_PAGE }); })
      .catch(() => { if (!cancelled) setState({ rows: [], loading: false, error: "unreachable", more: false }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, kind, from, to, nonce]);

  const older = async () => {
    const last = state.rows[state.rows.length - 1];
    if (!last) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const { rows } = await api(query({ at: last.at, key: last.key }));
      setState((s) => ({ rows: [...s.rows, ...rows], loading: false, error: null, more: rows.length === AUDIT_PAGE }));
    } catch {
      setState((s) => ({ ...s, loading: false, error: "unreachable" }));
    }
  };

  const note = {margin:0,fontFamily:D.body,fontSize:"14px",color:D.textMuted};
  if (!live) return <p data-testid="audit-signin" style={note}>Sign in to see the audit log.</p>;

  const field = {minHeight:"44px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.sm,padding:"6px 10px",fontFamily:D.body,fontSize:"14px",color:D.textPrimary};
  const label = {display:"flex",flexDirection:"column",gap:"4px",fontFamily:D.body,fontSize:"12px",color:D.textMuted};
  return (
    <div data-testid="audit-log" style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      <p style={{...note,fontSize:"13px"}}>Who did what at your school, newest first. A child is named by initials, and your reading this is on the log too.</p>
      <div role="group" aria-label="Filter the audit log" style={{display:"flex",gap:"10px",flexWrap:"wrap",alignItems:"flex-end"}}>
        <label style={label}>Kind
          <select data-testid="audit-kind" value={kind} onChange={(e)=>setKind(e.target.value)} style={field}>
            <option value="">Everything</option>
            {AUDIT_KINDS.map(([k,l])=><option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label style={label}>From
          <input data-testid="audit-from" type="date" value={from} onChange={(e)=>setFrom(e.target.value)} style={field}/>
        </label>
        <label style={label}>To
          <input data-testid="audit-to" type="date" value={to} onChange={(e)=>setTo(e.target.value)} style={field}/>
        </label>
        {(kind||from||to)&&(
          <button type="button" className="pressBtn" onClick={()=>{setKind("");setFrom("");setTo("");setNonce((n)=>n+1);}}
            style={{...field,cursor:"pointer",color:D.textSecondary}}>Clear</button>
        )}
      </div>
      {state.error&&<p data-testid="audit-error" style={{...note,color:D.roseText}}>The audit log could not be read — the server did not answer. This is not the same as there being nothing on it.</p>}
      {!state.error&&!state.loading&&state.rows.length===0&&(
        <p data-testid="audit-none" style={note}>Nothing on the audit log{kind||from||to?" for this filter":""}.</p>
      )}
      {state.rows.length>0&&(
        <ul data-testid="audit-rows" style={{listStyle:"none",margin:0,padding:0,border:`1px solid ${D.border}`,borderRadius:D.lg,background:D.surf1}}>
          {state.rows.map((r)=>(
            <li key={r.key} data-testid="audit-row" data-kind={r.kind} style={{display:"flex",gap:"12px",flexWrap:"wrap",padding:"10px 14px",borderTop:`1px solid ${D.border}`}}>
              <div style={{flex:1,minWidth:"220px"}}>
                <div style={{fontFamily:D.body,fontSize:"14px",color:D.textPrimary}}>
                  <span style={{fontWeight:600}}>{auditActor(r)}</span> · {r.action}
                </div>
                <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,marginTop:"2px"}}>
                  {r.subject}{r.detail?.resource&&r.subjectKind!=="records"?` · ${r.detail.resource.replace(/_/g," ")}`:""}{r.detail?.fields?.length?` · ${r.detail.fields.join(", ")}`:""}{r.detail?.fixture?` · ${r.detail.fixture}`:""}{r.detail?.support?" · under a support session":""}{r.detail?.platformWide?" · from the platform":""}
                </div>
              </div>
              <time dateTime={r.at} style={{fontFamily:D.mono,fontSize:"12px",color:D.textMuted,alignSelf:"center"}}>{auditWhen(r.at)}</time>
            </li>
          ))}
        </ul>
      )}
      {state.loading&&<p style={note}>Loading…</p>}
      {state.more&&!state.loading&&(
        <button type="button" data-testid="audit-older" className="pressBtn" onClick={older}
          style={{alignSelf:"flex-start",minHeight:"44px",padding:"8px 18px",borderRadius:D.pill,cursor:"pointer",border:`1px solid ${D.border}`,background:"transparent",fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textSecondary}}>Older entries</button>
      )}
    </div>
  );
}

// THE GROUNDSKEEPER'S DUTIES, read-only. The five tasks that stood here were
// invented. What a groundskeeper is actually answerable for (SCRBRD-085's
// phone view, views/DayOfView.jsx) is the fixtures at the grounds he looks
// after and the pitch report for each, so this reads the same two reads: the
// fixture list, row-scoped to this reader, and the pitch reports filed. The
// report's status is said only for a signed-in reader — the demonstration has
// no reports to read, and "not filed" would be a claim about nothing.
function GroundDuties({ role }) {
  const fixtures = useLive("matches", role);
  const reports = useLive("pitch_report", role);
  const from = new Date().toLocaleDateString("en-CA");
  const duties = fixtures.rows
    .filter((m)=>(m.status==="upcoming"||m.status==="live")&&m.date&&m.date>=from)
    .sort((a,b)=>`${a.date} ${a.time??""}`.localeCompare(`${b.date} ${b.time??""}`));
  const filed = new Set(reports.rows.map((r)=>r.matchId));
  const note = {margin:0,fontFamily:D.body,fontSize:"14px",color:D.textMuted};
  if (fixtures.loading) return <p style={note}>Loading…</p>;
  if (fixtures.error) return <p style={{...note,color:D.roseText}}>The fixtures could not be read — the server did not answer. This is not the same as there being none.</p>;
  if (!duties.length) return <p data-testid="ground-duties-none" style={note}>No fixtures are coming up at your grounds.</p>;
  return (
    <div data-testid="ground-duties" style={{display:"flex",flexDirection:"column",gap:"10px"}}>
      <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}><Icon name="ground"/> Fixtures at your grounds</div>
      {duties.map((m)=>(
        <div key={m.id} data-testid="ground-duty" data-match-id={m.id} style={{borderRadius:D.lg,border:`1px solid ${D.border}`,background:D.surf1,padding:"12px 18px",display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:"200px"}}>
            <div style={{fontFamily:D.body,fontSize:"14px",fontWeight:600,color:D.textPrimary}}>{m.homeLabel??m.homeTeam} vs {m.awayLabel??m.awayTeam}</div>
            <div style={{fontFamily:D.mono,fontSize:"13px",color:D.textMuted,marginTop:"2px"}}>{humanDate(m.date)}{m.time?` · ${m.time}`:""} · {m.venue||"Ground not recorded"}</div>
          </div>
          {reports.live&&(
            <span data-testid="ground-duty-report" style={{padding:"4px 12px",borderRadius:D.pill,border:`1px ${filed.has(m.id)?"solid":"dashed"} ${D.border}`,fontFamily:D.body,fontSize:"13px",color:D.textSecondary}}>
              {filed.has(m.id)?"Pitch report filed":"Pitch report not yet filed"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// The requests this person may answer, from the server's own word
// (`decidable`). A guardian's or a pupil's needs the child named from the
// roster before it can be granted; the select is drawn only for those.
function RequestsPanel({ role, players }) {
  const [nudge, setNudge] = useState(0);
  const [pick, setPick] = useState({});
  const [side, setSide] = useState({});
  // What the server said to each answer, by request: { ok, text }. Said
  // only after its reply; a refusal stays on the row, and a line whose row has
  // gone from the list (answered, so no longer waiting) is shown under the heading.
  const [said, setSaid] = useState({});
  const [busy, setBusy] = useState(null);
  const rows = useLive("role_requests", role, nudge).rows.filter((r) => r.decidable);
  const gone = Object.entries(said).filter(([id]) => !rows.some((r) => r.id === id));
  // Every hook above this line, always: a hook after a conditional return
  // changes the hook count between renders and takes the screen down.
  if (!rows.length && !gone.length) return null;
  const teams = [...new Set(players.map((p) => p.team).filter(Boolean))].sort();
  const decide = async (r, grant) => {
    if (busy) return;
    const team = side[r.id] || r.team || null;
    const label = ROLES[r.role]?.label ?? r.role;
    setBusy(r.id);
    setSaid((m) => { const { [r.id]: _dropped, ...rest } = m; return rest; });
    try {
      await api(`/api/requests/${r.id}/decide`, { method: "POST", body: { grant, playerId: pick[r.id] || r.playerId || null, teamCode: team } });
      setSaid((m) => ({ ...m, [r.id]: { ok: true, text: decidedWords(grant, label, team) } }));
    } catch (e) {
      setSaid((m) => ({ ...m, [r.id]: { ok: false, text: decideWords(e) } }));
    }
    setBusy(null);
    setNudge((n) => n + 1);
  };
  const needsChild = (r) => ["guardian", "player", "selfaccess", "enquiry"].includes(r.role);
  // A coach is a coach of a side; a request that named none is granted by naming one here.
  const needsSide = (r) => ["coach", "assistantcoach", "teammanager"].includes(r.role) && !r.team;
  const ready = (r) => (!needsChild(r) || pick[r.id] || r.playerId) && (!needsSide(r) || side[r.id]);
  const line = (id, x) => (
    <div key={id} role={x.ok ? "status" : "alert"} data-testid={x.ok ? `request-done-${id}` : `request-refused-${id}`}
      style={{width:"100%",fontFamily:D.body,fontSize:"13px",lineHeight:1.4,color:textOn(x.ok ? D.emerald : D.rose)}}>
      {x.text}
    </div>
  );
  const sel = {background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.sm,padding:"4px 8px",minHeight:"44px",fontFamily:D.body,fontSize:"12px",color:D.textPrimary};
  return (
    <div data-testid="requests-panel" style={{border:`1px solid ${D.border}`,borderRadius:D.lg,background:D.surf1,padding:"14px"}}>
      <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"8px"}}>{rows.length ? `Requests to answer · ${rows.length}` : "Requests answered"}</div>
      {gone.map(([id, x]) => line(id, x))}
      {rows.map((r)=>(
        <div key={r.id} data-testid={`request-row-${r.id}`} style={{display:"flex",alignItems:"center",gap:"10px",padding:"8px 0",borderTop:`1px solid ${D.border}`,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:"200px"}}>
            <div style={{fontFamily:D.body,fontSize:"12px",color:D.textPrimary,fontWeight:600}}>{r.name} <span style={{color:D.textMuted,fontWeight:400}}>{r.email}</span></div>
            <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>{ROLES[r.role]?.label ?? r.role}{r.team?` · ${r.team}`:""}{r.note?` — ${r.note}`:""}</div>
            {r.askedUnverified&&<div data-testid={`request-unverified-${r.id}`} style={{fontFamily:D.body,fontSize:"12px",color:D.roseText}}>Asked before the email was verified: check with them before granting.</div>}
          </div>
          {needsChild(r)&&(
            <select value={pick[r.id]||r.playerId||""} onChange={(e)=>setPick((p)=>({...p,[r.id]:e.target.value}))} aria-label="Which player" style={sel}>
              <option value="">Which player?</option>
              {players.map((p)=><option key={p.id} value={p.id}>{p.name} · {p.team}</option>)}
            </select>
          )}
          {needsSide(r)&&(
            <select value={side[r.id]||""} onChange={(e)=>setSide((p)=>({...p,[r.id]:e.target.value}))} aria-label="Which side" style={sel}>
              <option value="">Which side?</option>
              {teams.map((t)=><option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <button onClick={()=>decide(r,true)} disabled={!ready(r)||!!busy} data-testid={`request-grant-${r.id}`} className="pressBtn" style={{padding:"5px 16px",minHeight:"44px",borderRadius:D.pill,border:"none",cursor:"pointer",background:D.emerald+"22",color:D.emerald,fontFamily:D.head,fontSize:"12px",fontWeight:700}}>Grant</button>
          <button onClick={()=>decide(r,false)} disabled={!!busy} data-testid={`request-decline-${r.id}`} className="pressBtn" style={{padding:"5px 16px",minHeight:"44px",borderRadius:D.pill,border:`1px solid ${D.border}`,cursor:"pointer",background:"transparent",color:D.textMuted,fontFamily:D.head,fontSize:"12px",fontWeight:700}}>Decline</button>
          {said[r.id]&&line(r.id, said[r.id])}
        </div>
      ))}
    </div>
  );
}

export { ManagementView };
