
import { useState } from "react";
import { D } from "../design/tokens.js";
import { dateStr, today } from "../lib/format.js";
import { Badge, Card, SectionHeader } from "../ui/primitives.jsx";
import { WeatherChip } from "./shared.jsx";
import { useRows, useWeather } from "../lib/live.js";

// ══════════════════════════════════════════════════════
//  ANALYTICS VIEW
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  FIXTURE CALENDAR VIEW
// ══════════════════════════════════════════════════════
function CalendarView({ role, onNav }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const MATCHES = useRows("matches", role);
  const TRAINING_SESSIONS = useRows("training", role);
  const WEATHER = useWeather(role);
  const [monthOffset, setMonthOffset] = useState(0);
  const [selDay,      setSelDay]      = useState(null);

  const base = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year  = base.getFullYear();
  const month = base.getMonth();
  const monthName = base.toLocaleString("en-ZA", { month:"long", year:"numeric" });

  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Bucket matches + sessions by date string
  const byDate = {};
  MATCHES.forEach(m => {
    if (!byDate[m.date]) byDate[m.date] = [];
    byDate[m.date].push({ kind:"match", ...m });
  });
  TRAINING_SESSIONS.forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push({ kind:"session", ...s });
  });

  const cellDate = n => `${year}-${String(month+1).padStart(2,"0")}-${String(n).padStart(2,"0")}`;
  const todayStr = dateStr(today);

  const EventDot = ({ kind, status, type }) => {
    const col = kind==="match"
      ? (status==="live"?D.emerald:status==="complete"?D.textMuted:D.sky)
      : (type==="fitness"?D.amber:type==="batting"?D.sky:type==="skills"?D.violet:D.emerald);
    return <div style={{ width:6, height:6, borderRadius:"50%", background:col, flexShrink:0 }}/>;
  };

  const selEvents = selDay ? (byDate[selDay] || []) : [];

  return (
    <div className="os-page">
      <SectionHeader title="Fixture Calendar" sub="Matches, training sessions and school schedule" color={D.sky}
        actions={
          <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
            <button onClick={()=>setMonthOffset(o=>o-1)} className="pressBtn" style={{background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,padding:"5px 12px",cursor:"pointer",color:D.textSecondary,fontSize:"14px"}}>‹</button>
            <span style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary,minWidth:"160px",textAlign:"center"}}>{monthName}</span>
            <button onClick={()=>setMonthOffset(o=>o+1)} className="pressBtn" style={{background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,padding:"5px 12px",cursor:"pointer",color:D.textSecondary,fontSize:"14px"}}>›</button>
            <button onClick={()=>setMonthOffset(0)} className="pressBtn" style={{background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.pill,padding:"5px 14px",cursor:"pointer",color:D.textMuted,fontFamily:D.body,fontSize:"11px"}}>Today</button>
          </div>
        }/>

      {/* Legend */}
      <div style={{display:"flex",gap:"14px",marginBottom:"16px",flexWrap:"wrap"}}>
        {[["Match – Live",D.emerald],["Match – Upcoming",D.sky],["Match – Complete",D.textMuted],["Training",D.violet]].map(([l,c])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:"6px"}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:c}}/>
            <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:selDay?"var(--g-side-r,1fr 300px)":"1fr",gap:"16px",alignItems:"start"}}>
        <Card sx={{padding:"0",overflow:"hidden"}}>
          {/* Day headers */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:D.surf2,borderBottom:`1px solid ${D.border}`}}>
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>(
              <div key={d} style={{padding:"10px 4px",textAlign:"center",fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.06em"}}>{d}</div>
            ))}
          </div>
          {/* Calendar grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
            {/* Leading blanks */}
            {Array.from({length:firstDow}).map((_,i)=>(
              <div key={`b${i}`} style={{minHeight:"80px",borderRight:`1px solid ${D.border}`,borderBottom:`1px solid ${D.border}`,background:D.surf2+"44"}}/>
            ))}
            {/* Day cells */}
            {Array.from({length:daysInMonth},(_,i)=>i+1).map(day=>{
              const ds = cellDate(day);
              const events = byDate[ds] || [];
              const isToday = ds === todayStr;
              const isSel   = ds === selDay;
              const hasLive = events.some(e=>e.status==="live");
              return (
                <div key={day} onClick={()=>setSelDay(isSel?null:ds)}
                  style={{
                    minHeight:"80px", padding:"6px", cursor:events.length?"pointer":"default",
                    borderRight:`1px solid ${D.border}`, borderBottom:`1px solid ${D.border}`,
                    background: isSel ? D.sky+"12" : hasLive ? D.emerald+"06" : "transparent",
                    transition:"background .15s",
                  }}>
                  <div style={{
                    width:"22px", height:"22px", borderRadius:"50%",
                    background: isToday ? D.indigo : "transparent",
                    display:"flex", alignItems:"center", justifyContent:"center", marginBottom:"4px",
                  }}>
                    <span style={{fontFamily:D.mono,fontSize:"11px",fontWeight:isToday?700:400,color:isToday?"#fff":D.textSecondary}}>{day}</span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
                    {events.slice(0,3).map((ev,i)=>{
                      const col = ev.kind==="match"
                        ? (ev.status==="live"?D.emerald:ev.status==="complete"?D.textMuted:D.sky)
                        : D.violet;
                      const label = ev.kind==="match"
                        ? ev.awayTeam.split(" ").slice(-2).join(" ")
                        : ev.title;
                      return (
                        <div key={i} style={{
                          padding:"1px 5px", borderRadius:"3px",
                          background:col+"20", border:`1px solid ${col}30`,
                          display:"flex", alignItems:"center", gap:"3px",
                        }}>
                          <div style={{width:4,height:4,borderRadius:"50%",background:col,flexShrink:0}}/>
                          <span style={{fontFamily:D.body,fontSize:"9px",color:col,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"68px"}}>{label}</span>
                        </div>
                      );
                    })}
                    {events.length>3&&<span style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted}}>+{events.length-3} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Day detail panel */}
        {selDay&&(
          <Card sx={{padding:"16px",position:"sticky",top:"16px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
              <div>
                <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>
                  {new Date(selDay+"T12:00").toLocaleDateString("en-ZA",{weekday:"long",day:"numeric",month:"long"})}
                </div>
                <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{selEvents.length} event{selEvents.length!==1?"s":""}</div>
              </div>
              <button onClick={()=>setSelDay(null)} style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"16px"}}>✕</button>
            </div>
            {selEvents.length===0&&(
              <div style={{textAlign:"center",padding:"24px",color:D.textMuted,fontFamily:D.body,fontSize:"12px"}}>No events on this day.</div>
            )}
            {selEvents.map((ev,i)=>{
              if (ev.kind==="match") {
                const w = WEATHER[ev.id];
                return (
                  <div key={i} style={{marginBottom:"12px",padding:"12px",background:ev.status==="live"?D.emerald+"0a":D.surf2,borderRadius:D.md,border:`1px solid ${ev.status==="live"?D.emerald+"33":D.border}`}}>
                    <div style={{display:"flex",gap:"6px",marginBottom:"8px",flexWrap:"wrap"}}>
                      <Badge color={ev.status==="live"?D.emerald:ev.status==="complete"?D.textMuted:D.sky}>{ev.status}</Badge>
                      <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>🏏 Match</span>
                    </div>
                    <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary,marginBottom:"3px"}}>{ev.homeTeam}</div>
                    <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"3px"}}>vs {ev.awayTeam}</div>
                    <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"8px"}}>📍 {ev.venue}</div>
                    {w&&<WeatherChip w={w} compact/>}
                    {ev.transport?.bus&&(
                      <div style={{marginTop:"6px",fontFamily:D.mono,fontSize:"10px",color:D.lime}}>🚌 Bus {ev.transport.depart}</div>
                    )}
                  </div>
                );
              }
              const typeCol = ev.type==="batting"?D.sky:ev.type==="bowling"||ev.type==="skills"?D.violet:ev.type==="fitness"?D.amber:D.emerald;
              return (
                <div key={i} style={{marginBottom:"12px",padding:"12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${typeCol}22`}}>
                  <div style={{display:"flex",gap:"6px",marginBottom:"6px"}}>
                    <Badge color={typeCol}>{ev.type}</Badge>
                    <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>💪 Training</span>
                  </div>
                  <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary,marginBottom:"3px"}}>{ev.title}</div>
                  <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{ev.team} · {ev.time} · {ev.duration}min</div>
                  <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>📍 {ev.venue}</div>
                </div>
              );
            })}
          </Card>
        )}
      </div>
    </div>
  );
}

export { CalendarView };
