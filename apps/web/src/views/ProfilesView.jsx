import { useState, useEffect } from "react";
import { KZN_SCHOOLS } from "../data/institution.js";
import { ROLES } from "../design/roles.js";
import { D } from "../design/tokens.js";
import { fitnessColor } from "../lib/format.js";
import { can, filterRecord, scoped, scopedSkills } from "../rbac/index.js";
import { Avatar, Badge, Card, Pill, RadarChart, SectionHeader, Select } from "../ui/primitives.jsx";

// ══════════════════════════════════════════════════════
//  SETTINGS / RBAC VIEW
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  SETTINGS / RBAC VIEW  — updated with new roles
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  PROFILES VIEW  — universal rich profiles
// ══════════════════════════════════════════════════════
function ProfilesView({ role, profileTarget, onClearTarget }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const COACHES = scoped("coaches", role);
  const INJURIES = scoped("injuries", role);
  const PLAYERS = scoped("players", role);
  const SKILLS_MATRIX = scopedSkills(role);
  const STAFF = scoped("staff", role);
  const TRAINING_SESSIONS = scoped("training", role);
  const [cat,     setCat]     = useState("players");   // players | coaches | staff
  const [selId,   setSelId]   = useState(profileTarget || null);
  const [tab,     setTab]     = useState("overview");
  const [teamF,   setTeamF]   = useState("all");

  // Resolve target on first render, then consume it so a later manual
  // visit to Profiles doesn't re-select a stale deep-link target.
  useEffect(()=>{ if(profileTarget&&onClearTarget) onClearTarget(); },[]);
  const selPlayer = filterRecord(role,"players",PLAYERS.find(p=>p.id===selId));
  const selCoach  = filterRecord(role,"profiles",COACHES.find(c=>c.id===selId));
  const selStaff  = filterRecord(role,"profiles",STAFF.find(s=>s.id===selId));
  const selEntity = selPlayer || selCoach || selStaff;

  const handleSelect = (id, category) => {
    setSelId(id);
    setCat(category);
    setTab("overview");
  };

  // ── MiniSparkline ──
  const Spark = ({ data, color=D.emerald, height=28 }) => {
    const max = Math.max(...data, 1);
    const w = 6, gap = 3;
    return (
      <svg width={data.length*(w+gap)} height={height} style={{verticalAlign:"middle"}}>
        {data.map((v,i)=>{
          const h = Math.max(2,(v/max)*height);
          const c = v===0?D.rose:v>=5?D.amber:color;
          return <rect key={i} x={i*(w+gap)} y={height-h} width={w} height={h} rx="1.5" fill={c} opacity={0.85}/>;
        })}
      </svg>
    );
  };

  // ── Stat Box ──
  const StatBox = ({label,value,sub,color=D.textPrimary,big}) => (
    <div style={{textAlign:"center",padding:big?"14px 10px":"10px 8px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`}}>
      <div style={{fontFamily:D.mono,fontSize:big?"22px":"16px",fontWeight:700,color,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginTop:"2px"}}>{sub}</div>}
      <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"4px",lineHeight:1.2}}>{label}</div>
    </div>
  );

  // ── Player Profile Panel ──
  const PlayerProfile = ({p}) => {
    const skills = SKILLS_MATRIX[p.id];
    const inj = INJURIES.find(i=>i.player===p.id);
    const rCol = p.role==="BAT"?D.sky:p.role==="BOWL"?D.violet:p.role==="ALL"?D.emerald:D.amber;
    const tabs = ["overview","career","form","vs opponents","development"];
    const schoolInfo = p.school==="HIL"?"Hilton College":KZN_SCHOOLS.find(s=>s.abbr===p.school)?.name||p.school;

    return (
      <div style={{flex:1,overflowY:"auto"}}>
        {/* Hero header */}
        <div style={{background:`linear-gradient(135deg,${rCol}18,${D.surf1} 60%)`,padding:"24px",borderBottom:`1px solid ${D.border}`}}>
          <div style={{display:"flex",gap:"18px",alignItems:"flex-start",flexWrap:"wrap"}}>
            <div style={{position:"relative"}}>
              <div style={{width:"72px",height:"72px",borderRadius:"50%",background:`linear-gradient(135deg,${rCol}40,${rCol}20)`,border:`3px solid ${rCol}55`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <span style={{fontFamily:D.head,fontSize:"24px",fontWeight:800,color:rCol}}>{p.name.split(" ").map(w=>w[0]).join("").slice(0,2)}</span>
              </div>
              <div style={{position:"absolute",bottom:0,right:0,width:"18px",height:"18px",borderRadius:"50%",background:p.fitness==="fit"?D.emerald:p.fitness==="injured"?D.rose:D.amber,border:`2px solid ${D.surf1}`}}/>
            </div>
            <div style={{flex:1}}>
              <div style={{display:"flex",gap:"8px",alignItems:"center",flexWrap:"wrap",marginBottom:"4px"}}>
                <span style={{fontFamily:D.head,fontSize:"22px",fontWeight:800,color:D.textPrimary}}>{p.name}</span>
                {p.cap&&<span style={{padding:"2px 8px",borderRadius:D.pill,background:D.amber+"22",border:`1px solid ${D.amber}33`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.amber}}>{p.cap==="c"?"CAPTAIN":"VICE CAPTAIN"}</span>}
              </div>
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"8px"}}>
                <Badge color={rCol}>{p.role==="BAT"?"Batter":p.role==="BOWL"?"Bowler":p.role==="ALL"?"Allrounder":"WK Batter"}</Badge>
                <Badge color={D.sky}>{schoolInfo} · {p.team}</Badge>
                <Badge color={p.fitness==="fit"?D.emerald:p.fitness==="injured"?D.rose:D.orange}>{p.fitness}</Badge>
                {p.batHand&&<Badge color={D.textMuted}>{p.batHand}HB · {p.bowlArm}{p.bowlArm?"A":""} {p.bowlStyle==="F"?"Fast":p.bowlStyle==="S"?"Spin":"Medium"}</Badge>}
              </div>
              <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,maxWidth:"520px",lineHeight:1.5}}>{p.bio}</div>
            </div>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
              {p.born&&<div style={{textAlign:"center",padding:"8px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`}}>
                <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Born</div>
                <div style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,marginTop:"2px"}}>{p.born}</div>
              </div>}
              {p.height&&<div style={{textAlign:"center",padding:"8px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`}}>
                <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Height</div>
                <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginTop:"2px"}}>{p.height}</div>
              </div>}
              {p.weight&&<div style={{textAlign:"center",padding:"8px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`}}>
                <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Weight</div>
                <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginTop:"2px"}}>{p.weight}</div>
              </div>}
            </div>
          </div>
        </div>

        {/* Tab nav */}
        <div style={{display:"flex",gap:"4px",padding:"10px 16px",borderBottom:`1px solid ${D.border}`,overflowX:"auto"}}>
          {tabs.map(t=>(
            <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
              padding:"5px 14px",borderRadius:D.pill,cursor:"pointer",textTransform:"capitalize",flexShrink:0,
              border:`1px solid ${tab===t?rCol+"55":D.border}`,background:tab===t?rCol+"12":"transparent",
              fontFamily:D.body,fontSize:"11px",fontWeight:tab===t?600:400,color:tab===t?rCol:D.textMuted,
            }}>{t}</button>
          ))}
        </div>

        <div style={{padding:"18px"}}>
          {/* OVERVIEW TAB */}
          {tab==="overview"&&(
            <>
              {/* Season stats row */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(90px,1fr))",gap:"8px",marginBottom:"18px"}}>
                {p.avg>0&&<StatBox label="Batting Avg" value={p.avg} color={p.avg>=40?D.emerald:p.avg>=25?D.sky:D.amber} big/>}
                {p.sr>0&&<StatBox label="Strike Rate" value={p.sr} color={p.sr>=130?D.emerald:p.sr>=100?D.sky:D.amber} big/>}
                {p.wkts>0&&<StatBox label="Wickets" value={p.wkts} color={p.wkts>=15?D.rose:D.violet} big/>}
                {p.econ>0&&<StatBox label="Economy" value={p.econ} color={p.econ<=6.5?D.emerald:p.econ<=8?D.amber:D.rose} big/>}
                {p.careerTotals?.innings&&<StatBox label="Innings" value={p.careerTotals.innings} big/>}
                {p.careerTotals?.runs&&<StatBox label="Career Runs" value={p.careerTotals.runs} color={D.sky} big/>}
                {p.careerTotals?.hs&&<StatBox label="High Score" value={p.careerTotals.hs} color={D.amber} big/>}
                {p.careerTotals?.fifties!==undefined&&<StatBox label="50s / 100s" value={`${p.careerTotals.fifties}/${p.careerTotals.hundreds||0}`} big/>}
                {p.careerTotals?.wktsTotal>0&&<StatBox label="Career Wkts" value={p.careerTotals.wktsTotal} color={D.rose} big/>}
                {p.careerTotals?.stumpings!=null&&<StatBox label="Stumpings" value={p.careerTotals.stumpings} color={D.amber} big/>}
                {p.careerTotals?.catches!=null&&<StatBox label="Catches (WK)" value={p.careerTotals.catches} color={D.teal} big/>}
              </div>

              {/* Radar + injury side by side */}
              <div style={{display:"grid",gridTemplateColumns:skills?"1fr 1fr":"1fr",gap:"14px",marginBottom:"14px"}}>
                {skills&&(
                  <Card sx={{padding:"14px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>SKILLS RADAR</div>
                    <div style={{display:"flex",justifyContent:"center"}}>
                      <RadarChart data={{
                        Batting:  Math.round(Object.values(skills.batting).reduce((a,b)=>a+b,0)/Object.values(skills.batting).length),
                        Bowling:  Math.round(Object.values(skills.bowling).reduce((a,b)=>a+b,0)/Object.values(skills.bowling).length),
                        Fielding: Math.round(Object.values(skills.fielding).reduce((a,b)=>a+b,0)/Object.values(skills.fielding).length),
                        Fitness:  Math.round(Object.values(skills.fitness).reduce((a,b)=>a+b,0)/Object.values(skills.fitness).length),
                      }} color={rCol} size={160}/>
                    </div>
                  </Card>
                )}
                <Card sx={{padding:"14px"}}>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>PERSONAL</div>
                  {[
                    ["Hometown",    p.hometown||"—"],
                    ["School House",p.houseAtSchool||"—"],
                    ["Batting Pos", p.battingPos?`No. ${p.battingPos}`:"—"],
                    ["Bat / Bowl",  `${p.batHand}HB · ${p.bowlArm||"—"}A ${p.bowlStyle==="F"?"Fast":p.bowlStyle==="S"?"Spin":"Medium"}`],
                  ].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${D.border}`}}>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,fontWeight:500}}>{v}</span>
                    </div>
                  ))}
                  {inj&&(
                    <div style={{marginTop:"10px",padding:"8px 10px",background:D.rose+"0a",borderRadius:D.sm,border:`1px solid ${D.rose}22`}}>
                      <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.rose,letterSpacing:"0.08em",marginBottom:"3px"}}>CURRENT INJURY</div>
                      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{inj.type} · {inj.phase}</div>
                      <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,marginTop:"2px"}}>RTW: {inj.rtw}</div>
                    </div>
                  )}
                </Card>
              </div>

              {/* Recent form */}
              {p.form&&(
                <Card sx={{padding:"14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em"}}>FORM (LAST 8)</div>
                    <Spark data={p.form} color={rCol} height={32}/>
                  </div>
                  <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                    {p.form.map((v,i)=>(
                      <div key={i} style={{width:"36px",height:"36px",borderRadius:D.sm,background:v===0?D.rose+"20":v>=5?D.amber+"20":D.emerald+"20",border:`1px solid ${v===0?D.rose+"33":v>=5?D.amber+"33":D.emerald+"33"}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <span style={{fontFamily:D.mono,fontSize:"12px",fontWeight:700,color:v===0?D.rose:v>=5?D.amber:D.emerald}}>{v===0?"W":v}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}

          {/* CAREER TAB */}
          {tab==="career"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
              <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
                <Card sx={{padding:"14px"}}>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"12px"}}>BATTING CAREER</div>
                  {[
                    ["Innings",      p.careerTotals?.innings||"—"],
                    ["Total Runs",   p.careerTotals?.runs||"—"],
                    ["High Score",   p.careerTotals?.hs||"—"],
                    ["Fifties",      p.careerTotals?.fifties||0],
                    ["Hundreds",     p.careerTotals?.hundreds||0],
                    ["Batting Avg",  p.avg],
                    ["Strike Rate",  p.sr],
                  ].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${D.border}`}}>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                      <span style={{fontFamily:D.mono,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>{v}</span>
                    </div>
                  ))}
                </Card>
                {p.wkts>0&&(
                  <Card sx={{padding:"14px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"12px"}}>BOWLING CAREER</div>
                    {[
                      ["Career Wickets", p.careerTotals?.wktsTotal||"—"],
                      ["Season Wickets", p.wkts],
                      ["Economy Rate",   p.econ],
                      ["Balls Bowled",   p.careerTotals?.balls||"—"],
                      ["Maidens",        p.careerTotals?.maidens||0],
                      ["Bowl Arm",       `${p.bowlArm||"—"}-arm`],
                      ["Bowl Style",     p.bowlStyle==="F"?"Fast":p.bowlStyle==="S"?"Spin":"Medium"],
                    ].map(([l,v])=>(
                      <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${D.border}`}}>
                        <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                        <span style={{fontFamily:D.mono,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>{v}</span>
                      </div>
                    ))}
                  </Card>
                )}
              </div>
              {/* Batting position visual */}
              {p.battingPos&&(
                <Card sx={{padding:"14px"}}>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>BATTING POSITION</div>
                  <div style={{display:"flex",gap:"6px"}}>
                    {Array.from({length:11},(_,i)=>i+1).map(n=>(
                      <div key={n} style={{width:"32px",height:"32px",borderRadius:D.sm,display:"flex",alignItems:"center",justifyContent:"center",
                        background:n===p.battingPos?rCol:"transparent",
                        border:`1px solid ${n===p.battingPos?rCol:D.border}`,}}>
                        <span style={{fontFamily:D.mono,fontSize:"11px",fontWeight:n===p.battingPos?700:400,color:n===p.battingPos?"#fff":D.textMuted}}>{n}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* FORM TAB */}
          {tab==="form"&&(
            <div>
              {p.seasonForm?.length>0?(
                <Card>
                  <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>
                    2025 Season — Match by Match
                  </div>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead>
                      <tr style={{background:D.surf2}}>
                        {["Opponent","Date","Runs","Wkts","Result"].map(h=>(
                          <th key={h} style={{padding:"8px 12px",fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:h==="Opponent"||h==="Date"?"left":"center"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {p.seasonForm.map((s,i)=>(
                        <tr key={i} style={{borderTop:`1px solid ${D.border}`}}>
                          <td style={{padding:"9px 12px",fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{s.opp}</td>
                          <td style={{padding:"9px 12px",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{s.date}</td>
                          <td style={{padding:"9px 12px",textAlign:"center"}}>
                            {s.runs!=null?<span style={{fontFamily:D.mono,fontSize:"13px",fontWeight:700,color:s.runs>=50?D.amber:s.runs>=25?D.sky:s.runs===0?D.rose:D.textPrimary}}>{s.runs}</span>:<span style={{color:D.textMuted,fontSize:"11px"}}>—</span>}
                          </td>
                          <td style={{padding:"9px 12px",textAlign:"center"}}>
                            {s.wkts>0?<span style={{fontFamily:D.mono,fontSize:"13px",fontWeight:700,color:D.violet}}>{s.wkts}w</span>:<span style={{color:D.textMuted,fontSize:"11px"}}>—</span>}
                          </td>
                          <td style={{padding:"9px 12px",textAlign:"center"}}>
                            {s.result&&<Badge color={s.result==="W"?D.emerald:s.result==="L"?D.rose:s.result==="NR"?D.amber:D.textMuted}>{s.result}</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              ):(
                <div style={{textAlign:"center",padding:"40px",color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>No season form data yet.</div>
              )}
            </div>
          )}

          {/* VS OPPONENTS TAB */}
          {tab==="vs opponents"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {p.vsOpponents?Object.entries(p.vsOpponents).map(([opp,rec])=>{
                const wr = rec.avg||(rec.runs&&rec.P?Math.round(rec.runs/rec.P):null);
                return (
                  <Card key={opp} sx={{padding:"14px 16px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"14px",flexWrap:"wrap"}}>
                      <div style={{flex:1}}>
                        <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,marginBottom:"2px"}}>{opp}</div>
                        <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{rec.P} match{rec.P!==1?"es":""}</div>
                      </div>
                      {rec.runs!=null&&<StatBox label="Runs" value={rec.runs} color={D.sky}/>}
                      {rec.avg!=null&&<StatBox label="Avg" value={rec.avg} color={rec.avg>=40?D.emerald:D.amber}/>}
                      {rec.wkts!=null&&<StatBox label="Wkts" value={rec.wkts} color={D.rose}/>}
                    </div>
                  </Card>
                );
              }):(
                <div style={{textAlign:"center",padding:"40px",color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>No opponent data recorded yet.</div>
              )}
            </div>
          )}

          {/* DEVELOPMENT TAB */}
          {tab==="development"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
              {skills?(
                <>
                  {Object.entries(skills).map(([cat,vals])=>(
                    <Card key={cat} sx={{padding:"14px"}}>
                      <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"12px",textTransform:"uppercase"}}>{cat}</div>
                      <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                        {Object.entries(vals).map(([skill,score])=>{
                          const sc = score>=80?D.emerald:score>=65?D.sky:score>=50?D.amber:D.rose;
                          const label = score>=80?"Elite":score>=65?"Good":score>=50?"Avg":"Dev";
                          return (
                            <div key={skill} style={{display:"flex",alignItems:"center",gap:"10px"}}>
                              <div style={{width:"90px",fontFamily:D.body,fontSize:"11px",color:D.textSecondary,textTransform:"capitalize"}}>{skill}</div>
                              <div style={{flex:1,height:"6px",borderRadius:"3px",background:D.surf3,overflow:"hidden"}}>
                                <div style={{height:"100%",width:`${score}%`,borderRadius:"3px",background:sc,transition:"width .6s"}}/>
                              </div>
                              <div style={{fontFamily:D.mono,fontSize:"11px",fontWeight:600,color:sc,width:"28px",textAlign:"right"}}>{score}</div>
                              <Badge color={sc} style={{minWidth:"36px",textAlign:"center"}}>{label}</Badge>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  ))}
                </>
              ):(
                <Card sx={{padding:"32px",textAlign:"center"}}>
                  <div style={{fontSize:"28px",marginBottom:"10px"}}>🎯</div>
                  <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted}}>No skills assessment on file. Coach can add via Skills module.</div>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Coach Profile Panel ──
  const CoachProfile = ({c}) => {
    const tabs = ["overview","career","sessions"];
    const coachPlayers = PLAYERS.filter(p=>p.team===c.team && p.school==="HIL");
    return (
      <div style={{flex:1,overflowY:"auto"}}>
        <div style={{background:`linear-gradient(135deg,${D.emerald}18,${D.surf1} 60%)`,padding:"24px",borderBottom:`1px solid ${D.border}`}}>
          <div style={{display:"flex",gap:"18px",alignItems:"flex-start",flexWrap:"wrap"}}>
            <div style={{width:"72px",height:"72px",borderRadius:"50%",background:`linear-gradient(135deg,${D.emerald}40,${D.emerald}20)`,border:`3px solid ${D.emerald}55`,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontFamily:D.head,fontSize:"24px",fontWeight:800,color:D.emerald}}>{c.name.split(" ").filter(w=>w!=="Mr"&&w!=="Ms"&&w!=="Mrs").map(w=>w[0]).join("").slice(0,2)}</span>
            </div>
            <div style={{flex:1}}>
              <div style={{fontFamily:D.head,fontSize:"22px",fontWeight:800,color:D.textPrimary,marginBottom:"4px"}}>{c.name}</div>
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"8px"}}>
                <Badge color={D.emerald}>{c.role}</Badge>
                <Badge color={D.sky}>{c.team}</Badge>
                <Badge color={D.teal}>{c.qual}</Badge>
              </div>
              <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,maxWidth:"520px",lineHeight:1.5}}>{c.bio}</div>
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:"4px",padding:"10px 16px",borderBottom:`1px solid ${D.border}`}}>
          {tabs.map(t=>(
            <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
              padding:"5px 14px",borderRadius:D.pill,cursor:"pointer",textTransform:"capitalize",
              border:`1px solid ${tab===t?D.emerald+"55":D.border}`,background:tab===t?D.emerald+"12":"transparent",
              fontFamily:D.body,fontSize:"11px",fontWeight:tab===t?600:400,color:tab===t?D.emerald:D.textMuted,
            }}>{t}</button>
          ))}
        </div>
        <div style={{padding:"18px"}}>
          {tab==="overview"&&(
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",gap:"8px",marginBottom:"16px"}}>
                <StatBox label="Matches" value={c.stats.matchesCoached} big/>
                <StatBox label="Wins" value={c.stats.wins} color={D.emerald} big/>
                <StatBox label="Losses" value={c.stats.losses} color={D.rose} big/>
                <StatBox label="Win Rate" value={`${c.stats.winRate}%`} color={c.stats.winRate>=65?D.emerald:D.amber} big/>
                <StatBox label="Promoted" value={c.stats.playersPromoted} color={D.sky} sub="To Province" big/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
                <Card sx={{padding:"14px"}}>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>QUALIFICATIONS</div>
                  {c.qualifications.map(q=>(
                    <div key={q} style={{display:"flex",alignItems:"flex-start",gap:"7px",padding:"5px 0",borderBottom:`1px solid ${D.border}`}}>
                      <div style={{width:"5px",height:"5px",borderRadius:"50%",background:D.emerald,marginTop:"5px",flexShrink:0}}/>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{q}</span>
                    </div>
                  ))}
                </Card>
                <Card sx={{padding:"14px"}}>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>CONTACT</div>
                  {[["📞 Phone",c.phone],["✉️ Email",c.email],["🏠 Hometown",c.hometown||"—"],["🎂 Born",c.born||"—"]].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${D.border}`}}>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary}}>{v}</span>
                    </div>
                  ))}
                </Card>
              </div>
              <Card sx={{padding:"14px",marginTop:"12px"}}>
                <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>SQUAD — {c.team}</div>
                <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                  {coachPlayers.map(p=>(
                    <button key={p.id} onClick={()=>{handleSelect(p.id,"players");}} className="pressBtn" style={{
                      display:"flex",alignItems:"center",gap:"7px",padding:"6px 10px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,cursor:"pointer",
                    }}>
                      <Avatar name={p.name} size={24} color={fitnessColor(p.fitness)}/>
                      <div style={{textAlign:"left"}}>
                        <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:500,color:D.textPrimary}}>{p.name}</div>
                        <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{p.role}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </Card>
            </>
          )}
          {tab==="career"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {c.coachingCareer?.map((r,i)=>(
                <div key={i} style={{display:"flex",gap:"14px",alignItems:"center",padding:"12px 14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`}}>
                  <div style={{width:"8px",height:"8px",borderRadius:"50%",background:i===0?D.emerald:D.textMuted,flexShrink:0}}/>
                  <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted,width:"90px"}}>{r.year}</div>
                  <div>
                    <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>{r.role} · {r.team}</div>
                    <Badge color={r.level==="Provincial"?D.violet:r.level==="School"?D.sky:D.amber}>{r.level}</Badge>
                  </div>
                </div>
              ))}
              <Card sx={{padding:"14px",marginTop:"4px"}}>
                <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"8px"}}>SPECIALISATION</div>
                <p style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,lineHeight:1.6}}>{c.specialisation}</p>
                <div style={{marginTop:"10px",fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>📅 Availability: {c.availability}</div>
                {c.notes&&<div style={{marginTop:"8px",padding:"8px 10px",background:D.amber+"0a",borderRadius:D.sm,fontFamily:D.body,fontSize:"11px",color:D.textSecondary,fontStyle:"italic"}}>{c.notes}</div>}
              </Card>
            </div>
          )}
          {tab==="sessions"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {TRAINING_SESSIONS.filter(s=>s.coach===c.id).map(s=>(
                <Card key={s.id} sx={{padding:"13px 15px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
                    <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary}}>{s.title}</div>
                    <Badge color={s.type==="fitness"?D.amber:s.type==="batting"?D.sky:D.emerald}>{s.type}</Badge>
                  </div>
                  <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>{s.date} · {s.time} · {s.duration}min · {s.venue}</div>
                  <div style={{marginTop:"6px",display:"flex",gap:"4px",flexWrap:"wrap"}}>{s.drills.map(d=><Pill key={d} color={D.indigo}>{d}</Pill>)}</div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const hiltonPlayers = PLAYERS.filter(p=>p.school==="HIL");
  const westvillePlayers = PLAYERS.filter(p=>p.school==="WES");

  return (
    <div className="os-page">
      <SectionHeader title="Profiles" sub="Players · Coaches · Staff — in-depth profiles with stats and analysis" color={D.violet}/>

      <div style={{display:"grid",gridTemplateColumns:"var(--g-side-l,220px 1fr)",gap:"16px",alignItems:"start"}}>
        {/* Left: entity list */}
        <div>
          {/* Category tabs */}
          <div style={{display:"flex",gap:"4px",marginBottom:"12px"}}>
            {["players","coaches","staff"].map(c2=>(
              <button key={c2} onClick={()=>{setCat(c2);setSelId(null);}} className="pressBtn" style={{
                flex:1,padding:"6px 0",borderRadius:D.md,cursor:"pointer",textTransform:"capitalize",
                border:`1px solid ${cat===c2?D.violet+"55":D.border}`,background:cat===c2?D.violet+"14":"transparent",
                fontFamily:D.body,fontSize:"10px",fontWeight:cat===c2?600:400,color:cat===c2?D.violet:D.textMuted,
              }}>{c2}</button>
            ))}
          </div>

          {cat==="players"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
              {/* Hilton */}
              <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",padding:"4px 8px",marginTop:"4px"}}>HILTON COLLEGE</div>
              {["U19A","U15A","U13A"].map(team=>(
                <div key={team}>
                  <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,padding:"3px 8px"}}>{team}</div>
                  {hiltonPlayers.filter(p=>p.team===team).map(p=>(
                    <button key={p.id} onClick={()=>handleSelect(p.id,"players")} className="pressBtn" style={{
                      width:"100%",padding:"7px 10px",borderRadius:D.md,cursor:"pointer",textAlign:"left",marginBottom:"2px",
                      border:`1px solid ${selId===p.id?D.violet+"55":D.border}`,background:selId===p.id?D.violet+"10":D.surf1,
                    }}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                        <div style={{position:"relative",flexShrink:0}}>
                          <Avatar name={p.name} size={28} color={fitnessColor(p.fitness)}/>
                          <div style={{position:"absolute",bottom:-1,right:-1,width:"8px",height:"8px",borderRadius:"50%",background:fitnessColor(p.fitness),border:`1.5px solid ${D.surf1}`}}/>
                        </div>
                        <div style={{minWidth:0}}>
                          <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:selId===p.id?600:400,color:D.textPrimary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                          <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{p.role}{p.cap?` · ${p.cap.toUpperCase()}`:""}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
              {/* Westville */}
              <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",padding:"4px 8px",marginTop:"8px"}}>WESTVILLE BOYS' HIGH</div>
              {["U19A","U15A"].map(team=>(
                <div key={team}>
                  <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,padding:"3px 8px"}}>{team}</div>
                  {westvillePlayers.filter(p=>p.team===team).map(p=>(
                    <button key={p.id} onClick={()=>handleSelect(p.id,"players")} className="pressBtn" style={{
                      width:"100%",padding:"7px 10px",borderRadius:D.md,cursor:"pointer",textAlign:"left",marginBottom:"2px",
                      border:`1px solid ${selId===p.id?D.amber+"55":D.border}`,background:selId===p.id?D.amber+"10":D.surf1,
                    }}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                        <Avatar name={p.name} size={28} color={D.amber}/>
                        <div style={{minWidth:0}}>
                          <div style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                          <div style={{fontFamily:D.mono,fontSize:"9px",color:D.amber}}>WES · {p.role}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {cat==="coaches"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
              {COACHES.map(c2=>(
                <button key={c2.id} onClick={()=>handleSelect(c2.id,"coaches")} className="pressBtn" style={{
                  width:"100%",padding:"9px 10px",borderRadius:D.md,cursor:"pointer",textAlign:"left",marginBottom:"2px",
                  border:`1px solid ${selId===c2.id?D.emerald+"55":D.border}`,background:selId===c2.id?D.emerald+"10":D.surf1,
                }}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <Avatar name={c2.name} size={30} color={D.emerald}/>
                    <div>
                      <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:500,color:D.textPrimary}}>{c2.name.split(" ").slice(1).join(" ")}</div>
                      <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{c2.role} · {c2.team}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {cat==="staff"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
              {["scorer","medical","driver","groundskeeper"].map(sRole=>(
                <div key={sRole}>
                  <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:ROLES[sRole]?.color||D.textMuted,letterSpacing:"0.08em",padding:"4px 8px",marginTop:"4px",textTransform:"uppercase"}}>{sRole}s</div>
                  {STAFF.filter(s=>s.role===sRole).map(s=>(
                    <button key={s.id} onClick={()=>handleSelect(s.id,"staff")} className="pressBtn" style={{
                      width:"100%",padding:"7px 10px",borderRadius:D.md,cursor:"pointer",textAlign:"left",marginBottom:"2px",
                      border:`1px solid ${selId===s.id?(ROLES[s.role]?.color||D.cyan)+"55":D.border}`,background:selId===s.id?(ROLES[s.role]?.color||D.cyan)+"10":D.surf1,
                    }}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                        <Avatar name={s.name} size={28} color={ROLES[s.role]?.color||D.cyan}/>
                        <div style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name.split(" ").slice(1).join(" ")}</div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: profile detail */}
        <div style={{minHeight:"500px",display:"flex",flexDirection:"column"}}>
          {!selId&&(
            <Card sx={{padding:"60px",textAlign:"center",flex:1}}>
              <div style={{fontSize:"48px",marginBottom:"16px"}}>👤</div>
              <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary,marginBottom:"8px"}}>Select a Profile</div>
              <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted}}>Choose a player, coach or staff member from the list to view their full profile.</div>
            </Card>
          )}
          {selId&&selPlayer&&<PlayerProfile p={selPlayer}/>}
          {selId&&selCoach&&!selPlayer&&<CoachProfile c={selCoach}/>}
          {selId&&selStaff&&!selPlayer&&!selCoach&&(
            <Card sx={{padding:"24px"}}>
              <div style={{fontFamily:D.head,fontSize:"18px",fontWeight:800,color:D.textPrimary,marginBottom:"6px"}}>{selStaff.name}</div>
              <Badge color={ROLES[selStaff.role]?.color||D.cyan}>{selStaff.role}</Badge>
              <div style={{marginTop:"12px",fontFamily:D.body,fontSize:"13px",color:D.textSecondary,lineHeight:1.6}}>{selStaff.experience}</div>
              <div style={{marginTop:"10px",fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>📞 {selStaff.phone} · ✉️ {selStaff.email}</div>
              <div style={{marginTop:"8px",fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>Full staff profile available in the Staff module →</div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export { ProfilesView };
