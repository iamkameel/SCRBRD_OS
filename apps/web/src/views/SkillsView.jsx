
import { useState } from "react";
import { D } from "../design/tokens.js";
import { fitnessColor } from "../lib/format.js";
import { Avatar, Badge, Btn, Card, EmptyState, RadarChart, SectionHeader } from "../ui/primitives.jsx";
import { useLive, useSkills } from "../lib/live.js";

// ══════════════════════════════════════════════════════
//  SKILLS MATRIX VIEW
// ══════════════════════════════════════════════════════
function SkillsView({ role }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const { rows: PLAYERS, loading, error } = useLive("players", role);
  const SKILLS_MATRIX = useSkills(role);
  // The selected PLAYER ID, not the player row — see FieldsView for the same
  // change and the same reason: a row captured at first render belongs to a
  // list that no longer exists once the server answers.
  const [selId, setSelId]         = useState(null);
  const [category, setCategory]   = useState("batting");
  const selPlayer = PLAYERS.find(p => p.id === selId) ?? PLAYERS[0];
  const skills = selPlayer ? SKILLS_MATRIX[selPlayer.id] : null;
  const canEdit = role==="superadmin"||role==="coach";
  const cats = skills ? Object.keys(skills) : [];
  const SKILL_COLORS = { batting:D.sky, bowling:D.violet, fielding:D.emerald, fitness:D.amber };

  const progressColorForScore = v => v>=80?D.emerald:v>=60?D.sky:v>=40?D.amber:D.rose;

  if (!selPlayer) return (
    <div className="os-page">
      <SectionHeader title="Skills Matrix" sub="Player development tracking & assessment" color={D.violet}/>
      <EmptyState loading={loading} error={error} icon="◎" message="No players are in scope for you." />
    </div>
  );

  return (
    <div className="os-page">
      <SectionHeader title="Skills Matrix" sub="Player development tracking & assessment" color={D.violet}
        actions={canEdit&&<Btn size="sm">+ Run Assessment</Btn>}/>
      <div style={{display:"grid",gridTemplateColumns:"var(--g-side-l,220px 1fr)",gap:"16px",alignItems:"start"}}>
        {/* Player list */}
        <Card sx={{padding:"0"}}>
          <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`}}>
            <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em"}}>SELECT PLAYER</div>
          </div>
          <div style={{maxHeight:"calc(100vh - 200px)",overflowY:"auto"}}>
            {PLAYERS.filter(p=>SKILLS_MATRIX[p.id]).map(p=>{
              const s=SKILLS_MATRIX[p.id];
              const overall=Math.round(Object.values(s).flatMap(c=>Object.values(c)).reduce((a,b)=>a+b,0)/Object.values(s).flatMap(c=>Object.values(c)).length);
              return (
                <button key={p.id} onClick={()=>setSelId(p.id)} className="pressBtn" style={{
                  width:"100%",padding:"10px 14px",display:"flex",alignItems:"center",gap:"9px",
                  background:selPlayer.id===p.id?D.violet+"12":"transparent",
                  border:`1px solid ${selPlayer.id===p.id?D.violet+"33":"transparent"}`,
                  borderRadius:D.md,margin:"1px 5px",width:"calc(100% - 10px)",cursor:"pointer",
                }}>
                  <Avatar name={p.name} size={32} color={selPlayer.id===p.id?D.violet:D.textMuted}/>
                  <div style={{flex:1,textAlign:"left"}}>
                    <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:selPlayer.id===p.id?600:400,color:selPlayer.id===p.id?D.textPrimary:D.textSecondary}}>{p.name.split(" ").pop()}</div>
                    <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{p.team}</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:700,color:progressColorForScore(overall)}}>{overall}</div>
                    <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted}}>OVR</div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Skills detail */}
        <div>
          {/* Header */}
          <Card sx={{padding:"16px",marginBottom:"14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"14px"}}>
              <Avatar name={selPlayer.name} size={52} color={D.violet}/>
              <div style={{flex:1}}>
                <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary}}>{selPlayer.name}</div>
                <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginBottom:"8px"}}>{selPlayer.team} · {selPlayer.role} · {selPlayer.batHand}HB</div>
                <div style={{display:"flex",gap:"6px"}}>
                  <Badge color={D.sky}>{selPlayer.role}</Badge>
                  <Badge color={fitnessColor(selPlayer.fitness)}>{selPlayer.fitness}</Badge>
                </div>
              </div>
              {skills&&(
                <div style={{display:"flex",gap:"10px"}}>
                  {Object.entries(skills).map(([cat,data])=>{
                    const avg=Math.round(Object.values(data).reduce((a,b)=>a+b,0)/Object.values(data).length);
                    return (
                      <div key={cat} style={{textAlign:"center"}}>
                        <div style={{fontFamily:D.mono,fontSize:"18px",fontWeight:700,color:SKILL_COLORS[cat]||D.indigo}}>{avg}</div>
                        <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted,textTransform:"capitalize"}}>{cat}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          {skills?(
            <>
              {/* Category tabs */}
              <div style={{display:"flex",gap:"6px",marginBottom:"16px"}}>
                {cats.map(c=>(
                  <button key={c} onClick={()=>setCategory(c)} className="pressBtn" style={{
                    padding:"7px 16px",borderRadius:D.pill,cursor:"pointer",
                    border:`1px solid ${category===c?(SKILL_COLORS[c]||D.indigo)+"55":D.border}`,
                    background:category===c?(SKILL_COLORS[c]||D.indigo)+"14":"transparent",
                    fontFamily:D.body,fontSize:"12px",fontWeight:category===c?600:400,
                    color:category===c?D.textPrimary:D.textMuted,textTransform:"capitalize",
                  }}>{c}</button>
                ))}
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 180px",gap:"16px"}}>
                <Card sx={{padding:"16px"}}>
                  <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"14px",textTransform:"capitalize"}}>{category} Skills</div>
                  {Object.entries(skills[category]).map(([skill, val])=>(
                    <div key={skill} style={{marginBottom:"14px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"5px"}}>
                        <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textSecondary,textTransform:"capitalize"}}>{skill}</span>
                        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                          <span style={{fontFamily:D.mono,fontSize:"12px",color:progressColorForScore(val),fontWeight:600}}>{val}</span>
                          <Badge color={progressColorForScore(val)}>{val>=80?"Elite":val>=65?"Good":val>=45?"Avg":"Dev"}</Badge>
                        </div>
                      </div>
                      <div style={{width:"100%",height:"8px",background:D.surf3,borderRadius:"4px",overflow:"hidden"}}>
                        <div className="skill-bar" style={{height:"100%",width:`${val}%`,background:`linear-gradient(90deg,${SKILL_COLORS[category]||D.indigo},${progressColorForScore(val)})`,borderRadius:"4px"}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",marginTop:"3px"}}>
                        <span style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted}}>0</span>
                        <span style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted}}>Target: 90</span>
                        <span style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted}}>100</span>
                      </div>
                    </div>
                  ))}
                  {canEdit&&<Btn size="sm" variant="ghost" onClick={()=>{}}>Update Scores</Btn>}
                </Card>
                <div>
                  <Card sx={{padding:"14px",marginBottom:"12px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.06em",marginBottom:"10px"}}>RADAR</div>
                    <div style={{display:"flex",justifyContent:"center"}}>
                      <RadarChart data={skills[category]} color={SKILL_COLORS[category]||D.indigo} size={150}/>
                    </div>
                  </Card>
                  <Card sx={{padding:"14px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.06em",marginBottom:"10px"}}>DEV PLAN</div>
                    {Object.entries(skills[category]).sort(([,a],[,b])=>a-b).slice(0,3).map(([s,v])=>(
                      <div key={s} style={{padding:"7px 0",borderBottom:`1px solid ${D.border}`}}>
                        <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,textTransform:"capitalize",marginBottom:"2px"}}>{s}</div>
                        <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                          <div style={{flex:1,height:"3px",background:D.surf3,borderRadius:"2px",overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${v}%`,background:D.orange,borderRadius:"2px"}}/>
                          </div>
                          <span style={{fontFamily:D.mono,fontSize:"9px",color:D.orange}}>{v}→{Math.min(v+10,100)}</span>
                        </div>
                      </div>
                    ))}
                    <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"8px"}}>Focus areas for next quarter</div>
                  </Card>
                </div>
              </div>
            </>
          ):(
            <Card sx={{padding:"32px",textAlign:"center"}}>
              <div style={{fontSize:"32px",marginBottom:"12px"}}>🎯</div>
              <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted}}>No skills assessment available for this player yet.</div>
              {canEdit&&<div style={{marginTop:"14px"}}><Btn size="sm">Run Assessment</Btn></div>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export { SkillsView };
