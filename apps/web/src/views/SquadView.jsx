import { useState } from "react";
import { PLAYERS, SKILLS_MATRIX } from "../data/mock.js";
import { D } from "../design/tokens.js";
import { fitnessColor, roleColor } from "../lib/format.js";
import { SR } from "../scorer/format.js";
import { Avatar, Badge, Btn, Card, Input, Modal, RadarChart, SectionHeader, Select } from "../ui/primitives.jsx";

// ══════════════════════════════════════════════════════
//  SQUAD VIEW
// ══════════════════════════════════════════════════════
function SquadView({ role }) {
  const [team, setTeam]           = useState("U19A");
  const [selected, setSelected]   = useState(null);
  const [addModal, setAddModal]   = useState(false);
  const players = PLAYERS.filter(p=>p.team===team);
  const teams = [...new Set(PLAYERS.map(p=>p.team))];
  const canEdit = role==="superadmin"||role==="schooladmin"||role==="coach";

  const roleColor = r => r==="BAT"?D.sky:r==="BOWL"?D.violet:r==="ALL"?D.emerald:D.amber;
  return (
    <div className="os-page">
      <SectionHeader title="Squad Management" sub="Player rosters, profiles and availability" color={D.sky}
        actions={canEdit&&<Btn size="sm" onClick={()=>setAddModal(true)}>+ Add Player</Btn>}/>
      <div style={{display:"flex",gap:"8px",marginBottom:"20px"}}>
        {teams.map(t=>(
          <button key={t} onClick={()=>{setTeam(t);setSelected(null);}} className="pressBtn" style={{
            padding:"7px 18px",borderRadius:D.pill,border:`1px solid ${team===t?D.sky+"55":D.border}`,
            background:team===t?D.sky+"14":"transparent",cursor:"pointer",
            fontFamily:D.head,fontSize:"12px",fontWeight:700,color:team===t?D.sky:D.textMuted,
          }}>{t}</button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:selected?"1fr 320px":"1fr",gap:"16px"}}>
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:"12px"}}>
            {players.map(p=>(
              <Card key={p.id} onClick={()=>setSelected(p)} sx={{
                padding:"14px",cursor:"pointer",
                border:`1px solid ${selected?.id===p.id?D.sky+"55":p.fitness==="injured"?D.rose+"22":D.border}`,
                background:selected?.id===p.id?D.sky+"08":p.fitness==="injured"?D.rose+"05":D.surf1,
              }}>
                <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
                  <div style={{position:"relative"}}>
                    <Avatar name={p.name} size={40} color={roleColor(p.role)}/>
                    <div style={{position:"absolute",bottom:-2,right:-2,width:"11px",height:"11px",borderRadius:"50%",background:fitnessColor(p.fitness),border:`1.5px solid ${D.surf1}`}}/>
                  </div>
                  <div>
                    <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary,lineHeight:1.2}}>
                      {p.name} {p.cap==="c"?"(c)":p.cap==="vc"?"(vc)":""}
                    </div>
                    <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginTop:"2px"}}>{p.age}y · {p.batHand}HB · {p.bowlArm==="L"?"LA":"RA"}{p.bowlStyle}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"8px"}}>
                  <Badge color={roleColor(p.role)}>{p.role}</Badge>
                  <Badge color={fitnessColor(p.fitness)}>{p.fitness}</Badge>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"4px"}}>
                  <div style={{textAlign:"center",padding:"5px",background:D.surf2,borderRadius:D.sm}}>
                    <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:D.sky}}>{p.avg}</div>
                    <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted}}>avg</div>
                  </div>
                  {p.wkts>0?(
                    <div style={{textAlign:"center",padding:"5px",background:D.surf2,borderRadius:D.sm}}>
                      <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:D.violet}}>{p.wkts}</div>
                      <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted}}>wkts</div>
                    </div>
                  ):(
                    <div style={{textAlign:"center",padding:"5px",background:D.surf2,borderRadius:D.sm}}>
                      <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:D.amber}}>{p.sr}</div>
                      <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted}}>SR</div>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
        {/* Player detail */}
        {selected&&(
          <Card sx={{padding:"16px",position:"sticky",top:"16px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:"14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                <Avatar name={selected.name} size={48} color={roleColor(selected.role)}/>
                <div>
                  <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>{selected.name}</div>
                  <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{selected.team} · Age {selected.age}</div>
                </div>
              </div>
              <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"16px"}}>✕</button>
            </div>
            <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"14px"}}>
              <Badge color={roleColor(selected.role)}>{selected.role}</Badge>
              <Badge color={fitnessColor(selected.fitness)}>{selected.fitness}</Badge>
              <Badge color={selected.batHand==="L"?D.amber:D.sky}>{selected.batHand}HB</Badge>
              <Badge color={selected.bowlArm==="L"?D.violet:D.emerald}>{selected.bowlArm==="L"?"LA":"RA"}{selected.bowlStyle}</Badge>
            </div>
            <div style={{marginBottom:"14px"}}>
              <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"8px"}}>SEASON STATS</div>
              <div style={{display:"grid",gridTemplateColumns:"var(--g-3,1fr 1fr 1fr)",gap:"6px"}}>
                {[["AVG",selected.avg,D.sky],["SR",selected.sr,D.amber],["WKTS",selected.wkts,D.violet],["ECON",selected.econ||"-",D.emerald],["AGE",selected.age,D.textMuted],[selected.cap?"ROLE":"",(selected.cap||"").toUpperCase()||"-",D.amber]].filter(([l])=>l).map(([l,v,c])=>(
                  <div key={l} style={{textAlign:"center",padding:"7px 4px",background:D.surf2,borderRadius:D.sm}}>
                    <div style={{fontFamily:D.mono,fontSize:"14px",fontWeight:500,color:c}}>{v}</div>
                    <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted,marginTop:"2px"}}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{marginBottom:"14px"}}>
              <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"8px"}}>RECENT FORM</div>
              <div style={{display:"flex",gap:"4px"}}>
                {selected.form.map((v,i)=>{
                  const bg = v===0?"rgba(244,63,94,.3)":v>=5?D.amber+"44":v>=3?D.emerald+"33":D.sky+"22";
                  const tc = v===0?D.rose:v>=5?D.amber:v>=3?D.emerald:D.sky;
                  return <div key={i} style={{flex:1,textAlign:"center",padding:"5px 2px",borderRadius:D.sm,background:bg}}>
                    <span style={{fontFamily:D.mono,fontSize:"11px",fontWeight:700,color:tc}}>{v===0?"W":v}</span>
                  </div>;
                })}
              </div>
            </div>
            {SKILLS_MATRIX[selected.id]&&(
              <div>
                <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>SKILLS SNAPSHOT</div>
                <div style={{display:"flex",justifyContent:"center"}}>
                  <RadarChart data={SKILLS_MATRIX[selected.id].batting} color={D.sky} size={140}/>
                </div>
              </div>
            )}
            {canEdit&&(
              <div style={{display:"flex",gap:"6px",marginTop:"14px"}}>
                <Btn size="sm" variant="ghost" onClick={()=>{}}>Edit Profile</Btn>
                <Btn size="sm" variant="ghost" onClick={()=>{}}>Log Injury</Btn>
                <Btn size="sm" variant="ghost" onClick={()=>{}}>Set Availability</Btn>
              </div>
            )}
          </Card>
        )}
      </div>
      {addModal&&(
        <Modal title="Add Player" onClose={()=>setAddModal(false)}>
          <Input label="Full Name" value="" onChange={()=>{}} placeholder="First Last"/>
          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
            <Select label="Team" value="U19A" onChange={()=>{}} options={["U19A","U15A","U13A"]}/>
            <Select label="Role" value="BAT" onChange={()=>{}} options={["BAT","BOWL","ALL","WK"]}/>
            <Select label="Batting Hand" value="R" onChange={()=>{}} options={[{value:"R",label:"Right"},{value:"L",label:"Left"}]}/>
            <Input label="Age" value="" onChange={()=>{}} type="number" placeholder="15"/>
          </div>
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"8px"}}>
            <Btn variant="ghost" onClick={()=>setAddModal(false)}>Cancel</Btn>
            <Btn onClick={()=>setAddModal(false)}>Add Player</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

export { SquadView };
