
import { useState } from "react";
import { D } from "../design/tokens.js";
import { dateStr, today } from "../lib/format.js";
import { Avatar, Badge, Btn, Card, KPICard, SectionHeader, Select } from "../ui/primitives.jsx";
import { WeatherChip } from "./shared.jsx";
import { useLive, useRows, useWeather } from "../lib/live.js";
import { api } from "../lib/api.js";
import { schoolsWhere } from "../lib/session.js";
import { textOn } from "../design/tokens.js";
import { Icon } from "../ui/icons.jsx";

// A timestamp as a departure time. Absent renders as an em dash, never as a
// time: a trip with no departure recorded has none, and "00:00" would be a
// claim that the bus leaves at midnight.
const clock = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? "—"
    : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// ══════════════════════════════════════════════════════
//  LOGISTICS VIEW  — full overhaul
// ══════════════════════════════════════════════════════
function LogisticsView({ role }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const COACHES = useRows("coaches", role);
  const COMPETITIONS = useRows("competitions", role);
  const GROUNDS = useRows("grounds", role);
  const MATCHES = useRows("matches", role);
  const PLAYERS = useRows("players", role);
  const STAFF = useRows("staff", role);
  const WEATHER = useWeather(role);
  const [tab,       setTab]       = useState("transport");
  // The fleet and the trips, from the database.
  //
  // Every figure on this tab used to be computed in the browser over a mock
  // array hung on the staff record — s.vehicles — and a mock field on the
  // match — m.transport. That meant each one was the same number for every
  // reader and true for none of them: a parent, a coach and a transport
  // coordinator all saw an identical "Total Seats" that belonged to nobody's
  // school. These two reads are row-scoped like every other, so the numbers
  // are this reader's.
  const VEHICLES = useRows("vehicles", role);
  const TRIPS    = useRows("trips", role);
  const [manifest,  setManifest]  = useState(null);

  const condColor = c => c==="Excellent"||c==="Stocked"||c==="Certified"?D.emerald:c==="Good"?D.sky:c==="Mixed"||c==="Fair"?D.amber:D.rose;

  // Fixtures with a trip arranged, joined on the fixture rather than read off
  // a field the match never had.
  const tripFor = (id) => TRIPS.find(t=>t.matchId===id) ?? null;
  const upcomingTransport = MATCHES.filter(m=>tripFor(m.id));

  return (
    <div className="os-page">
      <SectionHeader title="Logistics" sub="Transport, the kit register and ground scheduling" color={D.orange}/>

      <div style={{display:"flex",gap:"6px",marginBottom:"20px",flexWrap:"wrap"}}>
        {["transport","equipment","grounds"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
            padding:"6px 18px", minHeight:"44px", borderRadius:D.pill, cursor:"pointer", textTransform:"capitalize",
            border:`1px solid ${tab===t?D.orange+"55":D.border}`,
            background:tab===t?D.orange+"14":"transparent",
            fontFamily:D.body, fontSize:"12px", fontWeight:tab===t?600:400,
            color:tab===t?D.orange:D.textMuted,
          }}>{t}</button>
        ))}
      </div>

      {/* ── TRANSPORT ── */}
      {tab==="transport"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"12px",marginBottom:"20px"}}>
            <KPICard label="Upcoming Away Trips" value={upcomingTransport.length} icon="bus" color={D.sky}/>
            <KPICard label="Drivers Available"   value={STAFF.filter(s=>s.role==="driver"&&s.active).length} icon="user" color={D.lime}/>
            <KPICard label="Vehicles In Service" value={VEHICLES.filter(v=>v.active).length} icon="van" color={D.teal}/>
            <KPICard label="Total Seats"         value={VEHICLES.filter(v=>v.active).reduce((a,v)=>a+(v.capacity||0),0)} icon="armchair" color={D.violet}/>
            {/* Only vehicles with a recorded service date can be counted. A bus
                nobody has booked in is not "due today" — it is unknown, and the
                mock version counted it as due because an absent date parsed to
                the epoch. */}
            <KPICard label="Services Due"        value={VEHICLES.filter(v=>v.nextService&&(new Date(v.nextService)-today)/86400000<=14).length} icon="wrench" color={D.amber} sub="Within 14 days"/>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
            {upcomingTransport.map(m=>{
              const trip     = tripFor(m.id);
              // The driver's name comes from the trip row, resolved server-side
              // — a reader who may not see the driver's account gets the trip
              // without the name rather than no trip at all.
              const driver   = trip?.driverId ? STAFF.find(s=>s.id===trip.driverId) : null;
              const vehicle  = trip?.vehicleId
                ? VEHICLES.find(v=>v.id===trip.vehicleId) ?? {
                    reg: trip.reg, description: trip.vehicleDescription, capacity: trip.capacity }
                : null;
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
                        <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginBottom:"2px"}}><Icon name="calendar"/> {m.date} · <Icon name="map-pin"/> {m.venue}</div>
                      </div>
                      {/* Timing block */}
                      <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                        <div style={{padding:"10px 14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,textAlign:"center",minWidth:"70px"}}>
                          <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"4px"}}>DEPARTS</div>
                          <div style={{fontFamily:D.mono,fontSize:"16px",fontWeight:700,color:D.sky}}>{clock(trip?.departAt)}</div>
                        </div>
                        <div style={{padding:"10px 14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,textAlign:"center",minWidth:"70px"}}>
                          <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"4px"}}>RETURNS</div>
                          <div style={{fontFamily:D.mono,fontSize:"16px",fontWeight:700,color:D.emerald}}>{clock(trip?.returnAt)}</div>
                        </div>
                        <div style={{padding:"10px 14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,textAlign:"center",minWidth:"70px"}}>
                          <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"4px"}}>SEATS</div>
                          <div style={{fontFamily:D.mono,fontSize:"16px",fontWeight:700,color:D.amber}}>{trip?.seatsTaken??"—"}</div>
                        </div>
                      </div>
                    </div>

                    {/* Driver + vehicle strip. Shown for any arranged trip:
                        a bus with no driver named yet is exactly the row a
                        transport coordinator is looking for. */}
                    {trip&&(
                      <div style={{marginTop:"12px",padding:"10px 14px",background:D.surf2,borderRadius:D.md,display:"flex",gap:"14px",alignItems:"center",flexWrap:"wrap"}}>
                        <div style={{display:"flex",gap:"9px",alignItems:"center"}}>
                          <Avatar name={driver?.name??trip.driverName??"?"} size={32} color={D.lime}/>
                          <div>
                            <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>
                              {driver?.name??trip.driverName??"No driver named yet"}
                            </div>
                            <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{driver?.phone??""}</div>
                          </div>
                        </div>
                        {/* Where the bus is, in the server's own word. */}
                        {trip.state!=="scheduled"&&(
                          <Badge color={trip.state==="arrived"?D.emerald:trip.state==="under_way"?D.sky:D.textMuted}>
                            {trip.state==="under_way"?"On the road":trip.state==="arrived"?"Arrived":"Cancelled"}
                          </Badge>
                        )}
                        {vehicle&&(
                          <>
                            <div style={{width:"1px",height:"32px",background:D.border}}/>
                            <div>
                              <div style={{fontFamily:D.mono,fontSize:"12px",fontWeight:700,color:textOn(D.lime)}}>{vehicle.reg}</div>
                              <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{vehicle.description} · {vehicle.capacity} seats{vehicle.condition?<> · <span style={{color:condColor(vehicle.condition)}}>{vehicle.condition}</span></>:null}</div>
                            </div>
                          </>
                        )}
                        <div style={{marginLeft:"auto",display:"flex",gap:"6px"}}>
                          <Btn size="sm" variant="ghost" onClick={()=>setManifest(isManifest?null:m)}>
                            {isManifest?"Close Manifest":<><Icon name="clipboard-list"/> Manifest</>}
                          </Btn>
                        </div>
                      </div>
                    )}

                    {/* Passenger manifest */}
                    {isManifest&&(()=>{
                      const team = m.homeTeam.includes("1XI")?PLAYERS.filter(p=>p.team==="1XI"):m.homeTeam.includes("U15")?PLAYERS.filter(p=>p.team==="U15A"):PLAYERS.filter(p=>p.team==="U13A");
                      const teamCoaches = COACHES.filter(c=>team.some(p=>c.team===p.team));
                      const allPassengers = [...team.map(p=>({name:p.name,type:"Player",team:p.team})), ...teamCoaches.map(c=>({name:c.name,type:"Coach",team:c.team}))];
                      const cap = vehicle?.capacity ?? null;
                      return (
                        <div style={{marginTop:"12px",padding:"14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.teal}22`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                            <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.teal,letterSpacing:"0.08em"}}>TRAVEL MANIFEST — {allPassengers.length} PASSENGERS</div>
                            {/* Against the VEHICLE's capacity, not against a
                                seat count somebody typed. The bus holds what
                                the bus holds, and the database refuses a trip
                                that names more passengers than that — this is
                                the same fact drawn early enough to be useful. */}
                            <Badge color={cap==null?D.textMuted:allPassengers.length<=cap?D.emerald:D.rose}>
                              {allPassengers.length}/{cap??"?"} seats
                            </Badge>
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
                            <Icon name="triangle-alert"/> All players must have signed indemnity forms. Medical kit carried by {STAFF.find(s=>s.role==="medical"&&s.active)?.name||"medical staff"}.
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
                <div style={{fontSize:"32px",marginBottom:"10px",color:D.textMuted}}><Icon name="bus"/></div>
                <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted}}>No bus trips scheduled for upcoming fixtures.</div>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ── EQUIPMENT ──
          One register. The kit register below is the school's real one (the
          roadmap's Officials & Kit Registers); a second, fixed inventory used
          to be drawn above it and never changed. */}
      {tab==="equipment"&&(
        <div>
          <KitRegister role={role}/>
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
                      {g.lights&&<Badge color={D.amber}><Icon name="lightbulb"/> Lights</Badge>}
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
                {todayMatches.length>0&&<div style={{marginBottom:"8px",padding:"6px 10px",background:D.emerald+"10",borderRadius:D.sm,border:`1px solid ${D.emerald}22`}}><span style={{fontFamily:D.body,fontSize:"11px",color:D.emerald}}><Icon name="stumps"/> Match today: {todayMatches[0].homeTeam} vs {todayMatches[0].awayTeam}</span></div>}
                {upcomingMatchesG.length>0&&<div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"8px"}}>Next match: {upcomingMatchesG[0].date}</div>}
                {gk&&(
                  <div style={{display:"flex",alignItems:"center",gap:"7px",marginTop:"8px",paddingTop:"8px",borderTop:`1px solid ${D.border}`}}>
                    <Avatar name={gk.name} size={24} color={D.teal}/>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{gk.name}</span>
                    <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginLeft:"auto"}}><Icon name="sprout"/> GK</span>
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

// THE KIT REGISTER, live: what the school holds, who has it, and the two acts
// on it — a bat goes out to a named boy, and it comes back. The count of what
// is out is the server's (`out`), never derived here: a browser that subtracts
// its own page of issues from a quantity will disagree with the next reader.
//
// Both controls are drawn for anyone the register itself was handed, and both
// are refused by the equipment_issue policy when the person may not write.
// Offering a button the server declines is a presentation bug; deciding here
// whether to offer it on permission grounds would be an access one.
function KitRegister({ role }) {
  const [nonce, setNonce] = useState(0);
  const { rows: KIT, live } = useLive("equipment", role, nonce);
  const ISSUES = useLive("equipment_issues", role, nonce).rows;
  const PLAYERS = useRows("players", role);
  const [pick, setPick] = useState({});
  const [said, setSaid] = useState("");
  const canKeep = schoolsWhere("team.manage").length > 0;
  // Nothing invented in its place: signed out there is no register to show,
  // and a school that has entered no kit has none to list.
  if (!live || KIT.length === 0) return (
    <Card sx={{padding:"14px",marginBottom:"12px"}} data-testid="kit-register-empty">
      <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>
        {live ? "No kit is on the register yet." : "Sign in to see the kit register."}
      </div>
    </Card>
  );
  const act = async (path) => {
    setSaid("");
    try { await api(path, { method: "POST", body: {} }); setNonce(n=>n+1); }
    catch (e) { setSaid(e.message || "Refused."); }
  };
  const give = async (eq) => {
    const playerId = pick[eq.id];
    if (!playerId) return;
    setSaid("");
    try {
      await api(`/api/equipment/${eq.id}/issue`, { method: "POST", body: { playerId } });
      setPick(p=>({ ...p, [eq.id]: "" })); setNonce(n=>n+1);
    } catch (e) { setSaid(e.message || "Refused."); }
  };
  const openFor = (eq) => ISSUES.filter(i=>i.equipmentId===eq.id&&!i.returnedOn);
  return (
    <Card sx={{padding:"14px",marginBottom:"12px"}} data-testid="kit-register">
      <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"4px"}}>The kit register</div>
      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"10px"}}>
        What the school holds, and who has it. A boy keeps it until he gives it back.
      </div>
      {said&&<div role="alert" style={{fontFamily:D.body,fontSize:"11px",color:textOn(D.rose),marginBottom:"8px"}}>{said}</div>}
      {KIT.map(eq=>{
        const out = openFor(eq);
        const spare = eq.quantity - (eq.out ?? 0);
        return (
          <div key={eq.id} data-testid={`kit-${eq.id}`} style={{padding:"10px 0",borderTop:`1px solid ${D.border}`}}>
            <div style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:"170px"}}>
                <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>{eq.label}</div>
                <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>
                  {eq.kind} · {eq.out ?? 0} of {eq.quantity} out{eq.condition?` · ${eq.condition}`:""}
                </div>
              </div>
              {canKeep&&(
                <>
                  <Select value={pick[eq.id]??""} onChange={(v)=>setPick(p=>({ ...p, [eq.id]: v }))}
                    options={[{ value:"", label: spare>0 ? "Issue to…" : "None spare" },
                              ...PLAYERS.map(pl=>({ value:pl.id, label:`${pl.name}${pl.team?` · ${pl.team}`:""}` }))]}/>
                  <Btn size="sm" onClick={()=>give(eq)} disabled={!pick[eq.id]}>Issue</Btn>
                </>
              )}
            </div>
            {out.map(i=>(
              <div key={i.id} style={{display:"flex",alignItems:"center",gap:"8px",paddingTop:"6px"}}>
                <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,flex:1}}>{i.name} since {i.issuedOn}</span>
                {canKeep&&<Btn variant="ghost" size="sm" onClick={()=>act(`/api/equipment-issues/${i.id}/return`)}>Given back</Btn>}
              </div>
            ))}
          </div>
        );
      })}
    </Card>
  );
}

export { LogisticsView };
