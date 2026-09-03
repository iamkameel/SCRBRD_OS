import { scoped } from "../rbac/index.js";
import { useState } from "react";
import { D, px } from "../design/tokens.js";
import { dateStr, fitnessColor, today } from "../lib/format.js";
import { Avatar, Badge, Card, ProgressBar, SectionHeader } from "../ui/primitives.jsx";

// ══════════════════════════════════════════════════════
//  ANALYTICS VIEW  — upgraded
// ══════════════════════════════════════════════════════
function AnalyticsView({ role }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const PLAYERS = scoped("players", role);
  const [teamFilter, setTeamFilter] = useState("U19A");
  const [subView,    setSubView]    = useState("performance");
  const players = PLAYERS.filter(p=>p.team===teamFilter);

  const BarChart = ({ data, colorFn, maxVal, height=80, label }) => {
    const mx = maxVal || Math.max(...data.map(d=>d.v), 1);
    return (
      <div>
        {label&&<div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"8px",textTransform:"uppercase"}}>{label}</div>}
        <div style={{display:"flex",gap:"4px",alignItems:"flex-end",height:px(height)}}>
          {data.map((d,i)=>(
            <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",height:"100%",justifyContent:"flex-end"}}>
              <div style={{fontFamily:D.mono,fontSize:"9px",color:colorFn?colorFn(d.v):D.textMuted}}>{d.v}</div>
              <div style={{width:"100%",borderRadius:"3px 3px 0 0",background:colorFn?colorFn(d.v):D.indigo,height:`${(d.v/mx)*100}%`,minHeight:2,opacity:0.85,transition:"height .5s"}}/>
              <div style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted,textAlign:"center",maxWidth:"40px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.l}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Simulated head-to-head vs KZN schools
  const H2H = [
    { opp:"Michaelhouse", P:6,W:4,L:2,lastResult:"Won by 28 runs",   lastDate:"2025-01-18" },
    { opp:"Maritzburg Col",P:4,W:2,L:2,lastResult:"Lost by 5 wkts",  lastDate:"2025-02-05" },
    { opp:"DHS",           P:5,W:3,L:2,lastResult:"Won by 44 runs",   lastDate:"2024-11-15" },
    { opp:"Kearsney",      P:7,W:5,L:2,lastResult:"Rain — No result", lastDate:dateStr(today) },
    { opp:"Glenwood",      P:3,W:3,L:0,lastResult:"Won by 8 wkts",   lastDate:"2024-10-22" },
    { opp:"Westville",     P:2,W:1,L:1,lastResult:"Lost by 3 runs",   lastDate:"2024-09-14" },
  ];

  // Phase analysis
  const PHASES = [
    { phase:"Powerplay (1–6)",    runsFor:52, runsAgainst:48, wktsFor:2,  wktsAgainst:3  },
    { phase:"Middle (7–14)",      runsFor:78, runsAgainst:62, wktsFor:3,  wktsAgainst:4  },
    { phase:"Death (15–20)",      runsFor:56, runsAgainst:44, wktsFor:5,  wktsAgainst:3  },
  ];

  // Season trend data (last 8 matches)
  const SEASON_TREND = [142,186,134,168,194,152,177,142];
  const SEASON_OPP   = [108,152,135,141,156,148,162,null];

  return (
    <div className="os-page">
      <SectionHeader title="Analytics" sub="Performance insights · KZN head-to-head · Phase analysis" color={D.sky}/>
      <div style={{display:"flex",gap:"6px",marginBottom:"16px",flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:"6px"}}>
          {["U19A","U15A","U13A"].map(t=>(
            <button key={t} onClick={()=>setTeamFilter(t)} className="pressBtn" style={{
              padding:"6px 16px",borderRadius:D.pill,border:`1px solid ${teamFilter===t?D.sky+"55":D.border}`,
              background:teamFilter===t?D.sky+"14":"transparent",cursor:"pointer",
              fontFamily:D.head,fontSize:"11px",fontWeight:700,color:teamFilter===t?D.sky:D.textMuted,
            }}>{t}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:"6px",marginLeft:"auto"}}>
          {["performance","phases","h2h","table"].map(v=>(
            <button key={v} onClick={()=>setSubView(v)} className="pressBtn" style={{
              padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",
              border:`1px solid ${subView===v?D.indigo+"55":D.border}`,
              background:subView===v?D.indigo+"14":"transparent",
              fontFamily:D.body,fontSize:"11px",fontWeight:subView===v?600:400,
              color:subView===v?D.textPrimary:D.textMuted,textTransform:"capitalize",
            }}>{v==="h2h"?"Head-to-Head":v.charAt(0).toUpperCase()+v.slice(1)}</button>
          ))}
        </div>
      </div>

      {subView==="performance"&&(
        <>
          {/* Season worm */}
          <Card sx={{padding:"16px",marginBottom:"14px"}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"14px"}}>Season Scores — Last 8 Matches</div>
            <div style={{position:"relative",height:"100px"}}>
              <svg viewBox={`0 0 ${SEASON_TREND.length*60} 100`} style={{width:"100%",height:"100px",overflow:"visible"}}>
                {/* Hilton line */}
                <polyline
                  points={SEASON_TREND.map((v,i)=>`${i*60+30},${100-(v/220)*90}`).join(" ")}
                  fill="none" stroke={D.emerald} strokeWidth="2" strokeLinejoin="round"/>
                {/* Opponent line */}
                <polyline
                  points={SEASON_OPP.filter(v=>v!==null).map((v,i)=>`${i*60+30},${100-(v/220)*90}`).join(" ")}
                  fill="none" stroke={D.rose} strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 3"/>
                {/* Dots */}
                {SEASON_TREND.map((v,i)=>(
                  <g key={i}>
                    <circle cx={i*60+30} cy={100-(v/220)*90} r="4" fill={D.emerald} stroke={D.surf1} strokeWidth="2"/>
                    <text x={i*60+30} y={100-(v/220)*90-8} textAnchor="middle" fontSize="8" fill={D.emerald} fontFamily={D.mono}>{v}</text>
                  </g>
                ))}
                {SEASON_OPP.filter(v=>v!==null).map((v,i)=>(
                  <circle key={i} cx={i*60+30} cy={100-(v/220)*90} r="3" fill={D.rose} stroke={D.surf1} strokeWidth="1.5"/>
                ))}
              </svg>
            </div>
            <div style={{display:"flex",gap:"16px",marginTop:"8px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"6px"}}><div style={{width:20,height:2,background:D.emerald}}/><span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Hilton</span></div>
              <div style={{display:"flex",alignItems:"center",gap:"6px"}}><div style={{width:20,height:2,background:D.rose,borderTop:"2px dashed"+(D.rose)}}/><span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Opposition</span></div>
            </div>
          </Card>
          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"14px",marginBottom:"14px"}}>
            <Card sx={{padding:"16px"}}>
              <BarChart label="Batting Averages"
                data={players.filter(p=>p.avg>0).sort((a,b)=>b.avg-a.avg).slice(0,7).map(p=>({l:p.name.split(" ").pop().slice(0,7),v:p.avg}))}
                colorFn={v=>v>=40?D.emerald:v>=25?D.sky:D.amber}/>
            </Card>
            <Card sx={{padding:"16px"}}>
              <BarChart label="Strike Rates"
                data={players.filter(p=>p.sr>0).sort((a,b)=>b.sr-a.sr).slice(0,7).map(p=>({l:p.name.split(" ").pop().slice(0,7),v:p.sr}))}
                maxVal={200} colorFn={v=>v>=130?D.emerald:v>=100?D.sky:D.orange}/>
            </Card>
            <Card sx={{padding:"16px"}}>
              <BarChart label="Wickets Taken"
                data={players.filter(p=>p.wkts>0).sort((a,b)=>b.wkts-a.wkts).slice(0,7).map(p=>({l:p.name.split(" ").pop().slice(0,7),v:p.wkts}))}
                colorFn={v=>v>=20?D.rose:v>=12?D.violet:D.indigo}/>
            </Card>
            <Card sx={{padding:"16px"}}>
              <BarChart label="Bowling Economy"
                data={players.filter(p=>p.econ>0).sort((a,b)=>a.econ-b.econ).slice(0,7).map(p=>({l:p.name.split(" ").pop().slice(0,7),v:p.econ}))}
                maxVal={12} colorFn={v=>v<=6.5?D.emerald:v<=8?D.amber:D.rose}/>
            </Card>
          </div>
        </>
      )}

      {subView==="phases"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
          {PHASES.map(ph=>{
            const netRPO = ((ph.runsFor - ph.runsAgainst)/8).toFixed(1);
            return (
              <Card key={ph.phase} sx={{padding:"16px"}}>
                <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,marginBottom:"12px"}}>{ph.phase}</div>
                <div style={{display:"grid",gridTemplateColumns:"var(--g-5,1fr 1fr 1fr 1fr 1fr)",gap:"10px"}}>
                  {[
                    ["Runs Scored",    ph.runsFor,          D.emerald],
                    ["Runs Conceded",  ph.runsAgainst,      D.rose],
                    ["Wkts Batting",   `${ph.wktsFor} lost`,D.amber],
                    ["Wkts Bowling",   `${ph.wktsAgainst} taken`,D.violet],
                    ["Net RPO",        netRPO>=0?`+${netRPO}`:netRPO, Number(netRPO)>=0?D.emerald:D.rose],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{textAlign:"center",padding:"10px 6px",background:D.surf2,borderRadius:D.md}}>
                      <div style={{fontFamily:D.mono,fontSize:"18px",fontWeight:700,color:c}}>{v}</div>
                      <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"4px"}}>{l}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:"12px",display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"8px"}}>
                  <div>
                    <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"4px"}}>Batting run rate</div>
                    <ProgressBar pct={Math.min(100,(ph.runsFor/8/12)*100)} color={D.emerald}/>
                    <div style={{fontFamily:D.mono,fontSize:"10px",color:D.emerald,marginTop:"2px"}}>{(ph.runsFor/8).toFixed(1)} RPO</div>
                  </div>
                  <div>
                    <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"4px"}}>Conceded run rate</div>
                    <ProgressBar pct={Math.min(100,(ph.runsAgainst/8/12)*100)} color={D.rose}/>
                    <div style={{fontFamily:D.mono,fontSize:"10px",color:D.rose,marginTop:"2px"}}>{(ph.runsAgainst/8).toFixed(1)} RPO</div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {subView==="h2h"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          <Card sx={{padding:"14px 16px",background:`linear-gradient(135deg,${D.indigo}08,${D.surf1})`,border:`1px solid ${D.indigo}22`}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.indigo,marginBottom:"4px"}}>KZN Rivals — Head-to-Head Record ({teamFilter})</div>
            <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>All-time results vs KZN school opponents</div>
          </Card>
          {H2H.map(r=>{
            const winPct = Math.round((r.W/r.P)*100);
            return (
              <Card key={r.opp} sx={{padding:"14px 16px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"14px",flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:"120px"}}>
                    <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,marginBottom:"3px"}}>{r.opp}</div>
                    <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Last: {r.lastDate} · <span style={{color:r.lastResult.includes("Won")?D.emerald:r.lastResult.includes("Lost")?D.rose:D.amber}}>{r.lastResult}</span></div>
                  </div>
                  <div style={{display:"flex",gap:"8px"}}>
                    {[["P",r.P,D.textMuted],["W",r.W,D.emerald],["L",r.L,D.rose]].map(([l,v,c])=>(
                      <div key={l} style={{textAlign:"center",padding:"7px 10px",background:D.surf2,borderRadius:D.md,minWidth:"36px"}}>
                        <div style={{fontFamily:D.mono,fontSize:"14px",fontWeight:700,color:c}}>{v}</div>
                        <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>{l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{minWidth:"100px"}}>
                    <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"4px"}}>Win rate</div>
                    <ProgressBar pct={winPct} color={winPct>=60?D.emerald:winPct>=40?D.amber:D.rose}/>
                    <div style={{fontFamily:D.mono,fontSize:"10px",color:winPct>=60?D.emerald:winPct>=40?D.amber:D.rose,marginTop:"2px"}}>{winPct}%</div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {subView==="table"&&(
        <Card>
          <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`}}>
            <span style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>Full Squad Stats — {teamFilter}</span>
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:D.surf2}}>
                  {["Player","Role","Hand","Avg","SR","Wkts","Econ","Form","Status"].map(h=>(
                    <th key={h} style={{padding:"9px 12px",fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:h==="Player"?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map((p,i)=>{
                  const rCol = p.role==="BAT"?D.sky:p.role==="BOWL"?D.violet:p.role==="ALL"?D.emerald:D.amber;
                  return (
                    <tr key={p.id} style={{borderTop:`1px solid ${D.border}`,background:i%2===0?"transparent":D.surf2+"44"}}>
                      <td style={{padding:"10px 12px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                          <Avatar name={p.name} size={26} color={rCol}/>
                          <div>
                            <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{p.name}</div>
                            {p.cap&&<span style={{fontFamily:D.mono,fontSize:"9px",color:D.amber}}>({p.cap})</span>}
                          </div>
                        </div>
                      </td>
                      <td style={{padding:"10px 12px",textAlign:"center"}}><Badge color={rCol}>{p.role}</Badge></td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"11px",color:p.batHand==="L"?D.amber:D.sky}}>{p.batHand}HB</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"12px",fontWeight:500,color:p.avg>=40?D.emerald:p.avg>=25?D.sky:D.amber}}>{p.avg}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"12px",color:p.sr>=130?D.emerald:p.sr>=100?D.sky:D.amber}}>{p.sr}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"12px",color:p.wkts>=15?D.rose:p.wkts>=8?D.violet:D.textMuted}}>{p.wkts||"—"}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"12px",color:p.econ&&p.econ<=6.5?D.emerald:p.econ&&p.econ<=8?D.amber:p.econ?D.rose:D.textMuted}}>{p.econ||"—"}</td>
                      <td style={{padding:"10px 12px"}}>
                        <div style={{display:"flex",gap:"2px"}}>
                          {p.form.slice(-5).map((v,j)=>(
                            <div key={j} style={{width:"13px",height:"13px",borderRadius:"2px",background:v===0?D.rose+"55":v>=5?D.amber+"66":D.emerald+"44",display:"flex",alignItems:"center",justifyContent:"center"}}>
                              <span style={{fontFamily:D.mono,fontSize:"9px",color:v===0?D.rose:v>=5?D.amber:D.emerald,fontWeight:700}}>{v===0?"W":v}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td style={{padding:"10px 12px",textAlign:"center"}}><Badge color={fitnessColor(p.fitness)}>{p.fitness}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export { AnalyticsView };
