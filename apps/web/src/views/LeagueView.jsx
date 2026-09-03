
import { useState } from "react";
import { D } from "../design/tokens.js";
import { SR } from "../scorer/format.js";
import { Avatar, Badge, Btn, Card, Input, Modal, Pill, SectionHeader, Select } from "../ui/primitives.jsx";
import { WeatherChip } from "./shared.jsx";
import { usePlayersWithCareer, useRows, useWeather } from "../lib/live.js";

// ══════════════════════════════════════════════════════
//  LEAGUE MANAGEMENT VIEW
// ══════════════════════════════════════════════════════
function LeagueView({ role }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const COMPETITIONS = useRows("competitions", role);
  const MATCHES = useRows("matches", role);
  const PLAYERS = usePlayersWithCareer(role);
  const WEATHER = useWeather(role);
  const [selComp, setSelComp] = useState("comp1");
  const [tab,     setTab]     = useState("table");
  const [editRow, setEditRow] = useState(null);  // team row being edited
  const [addFixture, setAddFixture] = useState(false);
  const comp = COMPETITIONS.find(c=>c.id===selComp);
  const canEdit = role==="superadmin"||role==="schooladmin";

  // Editable table row state
  const [tableEdit, setTableEdit] = useState({}); // { teamName: {W,L,NR} }

  const compMatches = MATCHES.filter(m=>m.competition===selComp);

  // Top performers from squad
  const topBat = PLAYERS.filter(p=>p.school==="HIL"&&p.avg>0).sort((a,b)=>b.avg-a.avg).slice(0,5);
  const topBowl = PLAYERS.filter(p=>p.school==="HIL"&&p.wkts>0).sort((a,b)=>b.wkts-a.wkts).slice(0,5);

  const NRR = (nrr) => (
    <span style={{fontFamily:D.mono,fontSize:"12px",fontWeight:600,color:nrr>0?D.emerald:nrr<0?D.rose:D.textMuted}}>
      {nrr>=0?"+":""}{nrr.toFixed(2)}
    </span>
  );

  return (
    <div className="os-page">
      <SectionHeader title="League Management" sub="Standings · Fixtures · Results · Top Performers" color={D.amber}
        actions={canEdit&&<Btn size="sm" onClick={()=>setAddFixture(true)}>+ Add Fixture</Btn>}/>

      {/* Competition selector */}
      <div style={{display:"flex",gap:"8px",marginBottom:"20px",flexWrap:"wrap"}}>
        {COMPETITIONS.map(c=>(
          <button key={c.id} onClick={()=>{setSelComp(c.id);setTab("table");}} className="pressBtn" style={{
            padding:"8px 16px",borderRadius:D.md,cursor:"pointer",textAlign:"left",
            border:`1px solid ${selComp===c.id?D.amber+"55":D.border}`,
            background:selComp===c.id?D.amber+"10":D.surf1,
          }}>
            <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:selComp===c.id?700:400,color:selComp===c.id?D.textPrimary:D.textSecondary}}>{c.name}</div>
            <div style={{display:"flex",gap:"4px",marginTop:"3px",flexWrap:"wrap"}}>
              <Badge color={D.sky}>{c.format}</Badge>
              <Badge color={D.teal}>{c.ageGroup}</Badge>
              <Badge color={c.active?D.emerald:D.textMuted}>{c.active?"Active":"Ended"}</Badge>
            </div>
          </button>
        ))}
      </div>

      {comp&&(
        <>
          {/* Tab bar */}
          <div style={{display:"flex",gap:"6px",marginBottom:"16px"}}>
            {["table","fixtures","results","performers"].filter(t=>{
              if(t==="table") return comp.table||comp.type==="league"||comp.type==="tournament";
              if(t==="performers") return true;
              return true;
            }).map(t=>(
              <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
                padding:"6px 16px",borderRadius:D.pill,cursor:"pointer",textTransform:"capitalize",
                border:`1px solid ${tab===t?D.amber+"55":D.border}`,background:tab===t?D.amber+"14":"transparent",
                fontFamily:D.body,fontSize:"11px",fontWeight:tab===t?600:400,color:tab===t?D.amber:D.textMuted,
              }}>{t}</button>
            ))}
          </div>

          {/* ── TABLE ── */}
          {tab==="table"&&(comp.table?(
            <Card>
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{comp.name}</div>
                  <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{comp.teams} teams · {comp.format} · {comp.region}</div>
                </div>
                {canEdit&&<Btn size="sm" variant="ghost" onClick={()=>setEditRow("all")}>Edit Standings</Btn>}
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{background:D.surf2}}>
                      {["#","Team","P","W","L","NR","Pts","NRR","Form","Action"].map(h=>(
                        <th key={h} style={{padding:"10px 12px",fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:h==="Team"?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comp.table.map((t,i)=>{
                      const isHilton = t.team.includes("Hilton");
                      const isEdit = editRow==="all";
                      const ed = tableEdit[t.team]||{};
                      return (
                        <tr key={t.team} style={{borderTop:`1px solid ${D.border}`,background:isHilton?D.indigo+"08":"transparent"}}>
                          <td style={{padding:"11px 12px",textAlign:"center"}}>
                            <div style={{width:"24px",height:"24px",borderRadius:"50%",background:i===0?D.amber+"22":D.surf2,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto"}}>
                              <span style={{fontFamily:D.mono,fontSize:"11px",fontWeight:700,color:i===0?D.amber:D.textMuted}}>{i+1}</span>
                            </div>
                          </td>
                          <td style={{padding:"11px 12px"}}>
                            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                              <div style={{width:"8px",height:"8px",borderRadius:"50%",background:isHilton?"#003366":"#888",flexShrink:0}}/>
                              <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:isHilton?700:400,color:isHilton?D.textPrimary:D.textSecondary}}>{t.team}</span>
                              {isHilton&&<Badge color={D.indigo}>Us</Badge>}
                            </div>
                          </td>
                          {["P","W","L","NR"].map(k=>(
                            <td key={k} style={{padding:"11px 12px",textAlign:"center"}}>
                              {isEdit&&k!=="P"?(
                                <input type="number" aria-label={`${t.team} — ${k}`} defaultValue={t[k]} onChange={e=>setTableEdit(prev=>({...prev,[t.team]:{...prev[t.team],[k]:Number(e.target.value)}}))}
                                  style={{width:"40px",background:D.surf2,border:`1px solid ${D.borderMed}`,borderRadius:D.sm,padding:"3px 6px",fontFamily:D.mono,fontSize:"11px",color:D.textPrimary,textAlign:"center"}}/>
                              ):(
                                <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textSecondary}}>{t[k]}</span>
                              )}
                            </td>
                          ))}
                          <td style={{padding:"11px 12px",textAlign:"center"}}>
                            <span style={{fontFamily:D.mono,fontSize:"14px",fontWeight:700,color:isHilton?D.emerald:D.textPrimary}}>{isEdit&&ed.pts!=null?ed.pts:t.pts}</span>
                          </td>
                          <td style={{padding:"11px 12px",textAlign:"center"}}>{NRR(t.nrr)}</td>
                          <td style={{padding:"11px 12px",textAlign:"center"}}>
                            <div style={{display:"flex",gap:"2px",justifyContent:"center"}}>
                              {Array.from({length:t.P},(_,j)=>j<t.W?"W":j<t.W+t.L?"L":"N").map((r,j)=>(
                                <div key={j} style={{width:"12px",height:"12px",borderRadius:"2px",background:r==="W"?D.emerald+"44":r==="L"?D.rose+"44":D.amber+"44",display:"flex",alignItems:"center",justifyContent:"center"}}>
                                  <span style={{fontFamily:D.mono,fontSize:"9px",fontWeight:700,color:r==="W"?D.emerald:r==="L"?D.rose:D.amber}}>{r}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                          <td style={{padding:"11px 12px",textAlign:"center"}}>
                            {canEdit&&isEdit&&(
                              <button onClick={()=>setEditRow(null)} style={{background:D.emerald+"18",border:`1px solid ${D.emerald}33`,borderRadius:D.sm,padding:"3px 8px",cursor:"pointer",color:D.emerald,fontFamily:D.body,fontSize:"10px"}}>Save</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {editRow==="all"&&<div style={{padding:"12px 16px",borderTop:`1px solid ${D.border}`}}><Btn onClick={()=>setEditRow(null)}>✓ Save Changes</Btn></div>}
            </Card>
          ):(
            <div style={{textAlign:"center",padding:"40px",color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>No standings table for this competition format.</div>
          ))}

          {/* ── CUP BRACKET ── */}
          {tab==="table"&&comp.bracket&&(
            <div style={{marginTop:"16px"}}>
              <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginBottom:"14px"}}>Cup Bracket</div>
              <div style={{display:"flex",gap:"16px",overflowX:"auto",paddingBottom:"8px"}}>
                {comp.bracket.map(round=>(
                  <div key={round.round} style={{minWidth:"220px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.amber,letterSpacing:"0.06em",marginBottom:"10px"}}>{round.round}</div>
                    <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                      {round.fixtures.map((f,i)=>(
                        <div key={i} style={{padding:"10px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${f.status==="complete"?D.emerald+"22":D.border}`}}>
                          <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:500,color:f.status==="complete"?D.textPrimary:D.textSecondary,marginBottom:"4px"}}>{f.home}</div>
                          <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginBottom:"4px"}}>VS</div>
                          <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:500,color:f.status==="complete"?D.textPrimary:D.textSecondary,marginBottom:"6px"}}>{f.away}</div>
                          {f.result&&<div style={{fontFamily:D.body,fontSize:"10px",color:f.result.includes("Hilton")?D.emerald:D.amber,fontStyle:"italic"}}>{f.result}</div>}
                          {!f.result&&f.status!=="pending"&&<Badge color={D.sky}>Upcoming</Badge>}
                          {f.status==="pending"&&<Badge color={D.textMuted}>TBD</Badge>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── FIXTURES ── */}
          {tab==="fixtures"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {compMatches.filter(m=>m.status==="upcoming").length===0&&(
                <Card sx={{padding:"32px",textAlign:"center"}}><div style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>No upcoming fixtures in this competition.</div></Card>
              )}
              {compMatches.filter(m=>m.status==="upcoming").map(m=>{
                const w = WEATHER[m.id];
                return (
                  <Card key={m.id} sx={{padding:"14px 16px"}}>
                    <div style={{display:"flex",gap:"16px",alignItems:"center",flexWrap:"wrap"}}>
                      <div style={{flex:1}}>
                        <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,marginBottom:"3px"}}>{m.homeTeam} <span style={{color:D.textMuted,fontSize:"12px",fontWeight:400}}>vs</span> {m.awayTeam}</div>
                        <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>📅 {m.date} · 📍 {m.venue}</div>
                      </div>
                      {w&&<WeatherChip w={w} compact/>}
                      {m.transport?.bus&&<Pill color={D.lime}>🚌 {m.transport.depart}</Pill>}
                      {canEdit&&<Btn size="sm" variant="ghost">Enter Result</Btn>}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* ── RESULTS ── */}
          {tab==="results"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {compMatches.filter(m=>m.status==="complete").length===0&&(
                <Card sx={{padding:"32px",textAlign:"center"}}><div style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>No results yet.</div></Card>
              )}
              {compMatches.filter(m=>m.status==="complete").map(m=>(
                <Card key={m.id} sx={{padding:"14px 16px",border:`1px solid ${m.result?.includes("Hilton")?D.emerald+"22":D.rose+"11"}`}}>
                  <div style={{display:"flex",gap:"12px",alignItems:"center",flexWrap:"wrap"}}>
                    <Badge color={m.result?.includes("Hilton")?D.emerald:D.rose}>{m.result?.includes("Hilton")?"W":"L"}</Badge>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{m.homeTeam} vs {m.awayTeam}</div>
                      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{m.date} · {m.venue}</div>
                    </div>
                    {m.scorecard&&(
                      <div style={{display:"flex",gap:"8px",fontFamily:D.mono,fontSize:"12px"}}>
                        <span style={{color:D.emerald}}>{m.scorecard.home.score} ({m.scorecard.home.overs})</span>
                        <span style={{color:D.textMuted}}>vs</span>
                        {m.scorecard.away&&<span style={{color:D.textSecondary}}>{m.scorecard.away.score} ({m.scorecard.away.overs})</span>}
                      </div>
                    )}
                    <div style={{fontFamily:D.body,fontSize:"11px",color:m.result?.includes("Hilton")?D.emerald:D.amber,fontStyle:"italic"}}>{m.result}</div>
                    {canEdit&&<Btn size="sm" variant="ghost">Edit</Btn>}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* ── TOP PERFORMERS ── */}
          {tab==="performers"&&(
            <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"14px"}}>
              <Card>
                <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>🏏 Top Batters — {comp.ageGroup}</div>
                {topBat.map((p,i)=>(
                  <div key={p.id} style={{padding:"10px 14px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"10px"}}>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted,width:"16px"}}>{i+1}</span>
                    <Avatar name={p.name} size={28} color={D.sky}/>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{p.name}</div>
                      <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{p.team}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:D.mono,fontSize:"14px",fontWeight:700,color:p.avg>=40?D.emerald:D.sky}}>{p.avg}</div>
                      <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>avg</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:D.mono,fontSize:"13px",color:D.amber}}>{p.sr}</div>
                      <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>SR</div>
                    </div>
                  </div>
                ))}
              </Card>
              <Card>
                <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>⚡ Top Bowlers — {comp.ageGroup}</div>
                {topBowl.map((p,i)=>(
                  <div key={p.id} style={{padding:"10px 14px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"10px"}}>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted,width:"16px"}}>{i+1}</span>
                    <Avatar name={p.name} size={28} color={D.violet}/>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{p.name}</div>
                      <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{p.team}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:D.mono,fontSize:"14px",fontWeight:700,color:D.roseText}}>{p.wkts}</div>
                      <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>wkts</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:D.mono,fontSize:"13px",color:p.econ<=6.5?D.emerald:D.amber}}>{p.econ}</div>
                      <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>econ</div>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          )}
        </>
      )}

      {addFixture&&(
        <Modal title="Add Fixture" onClose={()=>setAddFixture(false)}>
          <Input label="Home Team" value="" onChange={()=>{}} placeholder="e.g. Hilton U19A"/>
          <Input label="Away Team" value="" onChange={()=>{}} placeholder="e.g. Michaelhouse U19A"/>
          <Input label="Venue" value="" onChange={()=>{}} placeholder="Ground name"/>
          <Input label="Date" value="" onChange={()=>{}} type="date"/>
          <Select label="Competition" value={selComp} onChange={()=>{}} options={COMPETITIONS.map(c=>({value:c.id,label:c.name}))}/>
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"8px"}}>
            <Btn variant="ghost" onClick={()=>setAddFixture(false)}>Cancel</Btn>
            <Btn onClick={()=>setAddFixture(false)}>Create Fixture</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

export { LeagueView };
