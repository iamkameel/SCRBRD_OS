
import { useState } from "react";
import { D } from "../design/tokens.js";
import { Avatar, Badge, Btn, Card, EmptyState, SectionHeader } from "../ui/primitives.jsx";
import { useLive, useRows } from "../lib/live.js";

// ══════════════════════════════════════════════════════
//  FIELDS VIEW — rich ground & pitch profiles
// ══════════════════════════════════════════════════════
function FieldsView({ role }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const { rows: GROUNDS, loading, error } = useLive("grounds", role);
  const STAFF = useRows("staff", role);
  // Hold the selected ID, not the row. Rows now arrive from the server, so
  // seeding state with GROUNDS[0] captured an empty list on first render and
  // then read `.name` off undefined the moment the fetch resolved. An id
  // survives the list being replaced; a row object does not.
  const [selId, setSelId]         = useState(null);
  const [selPitch,  setSelPitch]  = useState(0);
  const [tab, setTab]             = useState("overview");
  const canEdit = role==="superadmin"||role==="schooladmin"||role==="groundskeeper";
  const selGround = GROUNDS.find(g => g.id === selId) ?? GROUNDS[0];
  const gk = selGround?.groundskeeper ? STAFF.find(s=>s.id===selGround.groundskeeper) : null;

  const condColor = c => c==="Excellent"||c==="Match-ready"?"emerald":c==="Good"?"sky":c==="Fair"||c==="Moderate"?"amber":"rose";
  const condC     = c => D[condColor(c)] || D.textMuted;

  const pitch = selGround?.pitches?.[selPitch];

  const PitchVisual = ({ p }) => {
    if (!p) return null;
    const cracksLevel = p.cracks==="None"?0:p.cracks==="Minor"?1:p.cracks==="Moderate"?2:p.cracks==="Settling"?1:3;
    const bounceColor = p.bounce?.includes("True")?D.emerald:p.bounce?.includes("Lively")?D.amber:p.bounce?.includes("low")?D.rose:D.sky;
    return (
      <div style={{background:D.surf2,borderRadius:D.lg,padding:"16px",border:`1px solid ${D.border}`,marginBottom:"14px"}}>
        <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"12px"}}>PITCH VISUAL — STRIP {p.num}</div>
        {/* Pitch diagram */}
        <div style={{display:"flex",justifyContent:"center",marginBottom:"14px"}}>
          <svg viewBox="0 0 80 220" style={{width:"60px",height:"165px"}}>
            {/* Pitch rectangle */}
            <rect x={5} y={5} width={70} height={210} rx={2} fill="#c8a96a" stroke="#8a7040" strokeWidth={1}/>
            {/* Crease lines */}
            <line x1={5} y1={35}  x2={75} y2={35}  stroke="white" strokeWidth={1.5} opacity={0.8}/>
            <line x1={5} y1={185} x2={75} y2={185} stroke="white" strokeWidth={1.5} opacity={0.8}/>
            <line x1={5} y1={45}  x2={75} y2={45}  stroke="white" strokeWidth={1} opacity={0.5}/>
            <line x1={5} y1={175} x2={75} y2={175} stroke="white" strokeWidth={1} opacity={0.5}/>
            {/* Stumps */}
            {[-8,0,8].map(x=>(
              <g key={x}>
                <rect x={35+x-1} y={20}  width={2} height={14} rx={0.5} fill="white"/>
                <rect x={35+x-1} y={186} width={2} height={14} rx={0.5} fill="white"/>
              </g>
            ))}
            {/* Cracks simulation */}
            {cracksLevel>=1&&[30,70,110,150].map(y=>(
              <line key={y} x1={10+Math.random()*10} y1={y} x2={30+Math.random()*20} y2={y+8} stroke="#6b4f20" strokeWidth={0.8} opacity={0.6}/>
            ))}
            {cracksLevel>=2&&[50,90,130,160].map(y=>(
              <line key={y} x1={40+Math.random()*10} y1={y} x2={60+Math.random()*10} y2={y+10} stroke="#5a3e1a" strokeWidth={1.2} opacity={0.7}/>
            ))}
            {/* Grass coverage */}
            {p.grass&&!p.grass.includes("N/A")&&(
              <rect x={5} y={5} width={70} height={210} rx={2} fill="#4a8c30" opacity={p.grass?.includes("short")?0.12:0.22}/>
            )}
          </svg>
        </div>
        {/* Pitch data grid */}
        <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"8px"}}>
          {[
            ["Surface",   p.surface,   D.textPrimary],
            ["Condition", p.condition, condC(p.condition)],
            ["Bounce",    p.bounce,    bounceColor],
            ["Cracks",    p.cracks,    p.cracks==="None"?D.emerald:D.orange],
            ["Grass",     p.grass||"—",D.lime],
            ["Moisture",  p.moisture||"—", D.sky],
            ["Spin Assist",p.spinAssist||"—",D.violet],
            ["Seam Move", p.seamMovement||"—",D.amber],
          ].map(([l,v,c])=>(
            <div key={l} style={{padding:"7px 10px",background:D.surf3,borderRadius:D.sm}}>
              <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted,marginBottom:"3px"}}>{l}</div>
              <div style={{fontFamily:D.mono,fontSize:"11px",fontWeight:600,color:c}}>{v}</div>
            </div>
          ))}
        </div>
        {p.history&&<div style={{marginTop:"10px",fontFamily:D.body,fontSize:"10px",color:D.textMuted,background:D.surf3,padding:"7px 10px",borderRadius:D.sm}}>📊 {p.history}</div>}
        {p.lastRolled&&<div style={{marginTop:"6px",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Last rolled: {p.lastRolled}</div>}
      </div>
    );
  };

  // No ground to show, for any of three different reasons. Rendering the
  // detail panel against `undefined` is how this crashed before the rows
  // became asynchronous.
  if (!selGround) return (
    <div className="os-page">
      <SectionHeader title="Fields & Pitch Profiles" sub="Ground management, pitch preparation and surface data" color={D.teal}/>
      <EmptyState loading={loading} error={error} icon="⬡" message="No grounds are in scope for you." />
    </div>
  );

  return (
    <div className="os-page">
      <SectionHeader title="Fields & Pitch Profiles" sub="Ground management, pitch preparation and surface data" color={D.teal}
        actions={canEdit&&<Btn size="sm">+ Pitch Report</Btn>}/>

      <div style={{display:"grid",gridTemplateColumns:"var(--g-side-l,200px 1fr)",gap:"16px",alignItems:"start"}}>
        {/* Ground list */}
        <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
          {GROUNDS.map(g=>(
            <button key={g.id} onClick={()=>{setSelId(g.id);setSelPitch(0);setTab("overview");}} className="pressBtn" style={{
              width:"100%",padding:"10px 12px",borderRadius:D.md,cursor:"pointer",textAlign:"left",
              border:`1px solid ${selGround.id===g.id?D.teal+"55":D.border}`,
              background:selGround.id===g.id?D.teal+"10":D.surf1,
            }}>
              <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:selGround.id===g.id?600:400,color:selGround.id===g.id?D.textPrimary:D.textSecondary,marginBottom:"3px"}}>{g.shortName||g.name}</div>
              <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
                <Badge color={g.type==="turf"?D.emerald:g.type==="nets"?D.sky:D.amber}>{g.type}</Badge>
                <Badge color={g.available?D.emerald:D.rose}>{g.available?"Open":"Closed"}</Badge>
              </div>
            </button>
          ))}
        </div>

        {/* Ground detail */}
        <div>
          {/* Header card */}
          <Card sx={{padding:"16px",marginBottom:"14px",background:`linear-gradient(135deg,${D.teal}08,${D.surf1})`}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"12px",flexWrap:"wrap"}}>
              <div>
                <div style={{fontFamily:D.head,fontSize:"18px",fontWeight:800,color:D.textPrimary,marginBottom:"4px"}}>{selGround.name}</div>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"8px"}}>
                  <Badge color={D.teal}>{selGround.type}</Badge>
                  <Badge color={selGround.available?D.emerald:D.rose}>{selGround.available?"Available":"Unavailable"}</Badge>
                  {selGround.lights&&<Badge color={D.amber}>💡 Lights</Badge>}
                  {selGround.homeTo?.map(t=><Badge key={t} color={D.sky}>{t}</Badge>)}
                </div>
                {selGround.orientation&&<div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>⬡ Orientation: {selGround.orientation}</div>}
                {selGround.dimensions&&<div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>📐 {selGround.dimensions.straight}m straight · {selGround.dimensions.squareLeg}m sq-leg · {selGround.dimensions.squareOff}m sq-off</div>}
              </div>
              {gk&&(
                <div style={{padding:"10px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,minWidth:"150px"}}>
                  <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"6px"}}>GROUNDSKEEPER</div>
                  <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <Avatar name={gk.name} size={28} color={D.teal}/>
                    <div>
                      <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:600,color:D.textPrimary}}>{gk.name.split(" ").slice(-1)[0]}</div>
                      <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{gk.phone}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Tabs */}
          <div style={{display:"flex",gap:"6px",marginBottom:"14px"}}>
            {["overview","pitches","facilities","prep"].filter(t=>selGround.type!=="nets"||["overview","pitches"].includes(t)).map(t=>(
              <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
                padding:"6px 16px",borderRadius:D.pill,cursor:"pointer",textTransform:"capitalize",
                border:`1px solid ${tab===t?D.teal+"55":D.border}`,
                background:tab===t?D.teal+"14":"transparent",
                fontFamily:D.body,fontSize:"11px",fontWeight:tab===t?600:400,
                color:tab===t?D.teal:D.textMuted,
              }}>{t}</button>
            ))}
          </div>

          {tab==="overview"&&(
            <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
              <Card sx={{padding:"14px"}}>
                <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>SURFACE</div>
                {[["Type",selGround.surfaceType||"—"],["Outfield Grade",selGround.outfieldGrade||"N/A"],["Mow Height",selGround.outfieldMowHeight||"N/A"],["Drainage",selGround.drainage||"—"]].map(([l,v])=>(
                  <div key={l} style={{padding:"6px 0",borderBottom:`1px solid ${D.border}`}}>
                    <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"2px"}}>{l}</div>
                    <div style={{fontFamily:D.body,fontSize:"12px",color:D.textPrimary}}>{v}</div>
                  </div>
                ))}
              </Card>
              <Card sx={{padding:"14px"}}>
                <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>PITCH SUMMARY</div>
                {selGround.pitches?.map((p,i)=>(
                  <div key={i} style={{padding:"7px 0",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>Strip {p.num} — {p.surface}</span>
                    <Badge color={condC(p.condition)}>{p.condition}</Badge>
                  </div>
                ))}
                {selGround.capacity&&<div style={{marginTop:"8px",fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>Capacity: {selGround.capacity.toLocaleString()} spectators</div>}
                {selGround.notes&&<div style={{marginTop:"8px",fontFamily:D.body,fontSize:"10px",color:D.textMuted,fontStyle:"italic"}}>{selGround.notes}</div>}
              </Card>
            </div>
          )}

          {tab==="pitches"&&selGround.pitches&&(
            <div>
              <div style={{display:"flex",gap:"6px",marginBottom:"14px"}}>
                {selGround.pitches.map((p,i)=>(
                  <button key={i} onClick={()=>setSelPitch(i)} className="pressBtn" style={{
                    padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",
                    border:`1px solid ${selPitch===i?D.amber+"55":D.border}`,
                    background:selPitch===i?D.amber+"12":"transparent",
                    fontFamily:D.body,fontSize:"11px",color:selPitch===i?D.amber:D.textMuted,
                  }}>Strip {p.num}</button>
                ))}
              </div>
              {pitch&&<PitchVisual p={pitch}/>}
            </div>
          )}

          {tab==="facilities"&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:"10px"}}>
              {Object.entries(selGround.facilities||{}).map(([k,v])=>(
                <div key={k} style={{padding:"10px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,textTransform:"capitalize"}}>{k.replace(/([A-Z])/g," $1")}</span>
                  <span style={{fontFamily:D.mono,fontSize:"12px",color:typeof v==="boolean"?(v?D.emerald:D.textMuted):D.amber,fontWeight:600}}>{typeof v==="boolean"?(v?"✓":"✗"):v}</span>
                </div>
              ))}
              {selGround.equipment&&Object.entries(selGround.equipment).map(([k,v])=>(
                <div key={k} style={{padding:"10px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,textTransform:"capitalize"}}>{k.replace(/([A-Z])/g," $1")}</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.sky}}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {tab==="prep"&&(
            <Card sx={{padding:"16px"}}>
              <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"14px"}}>Preparation Schedule</div>
              {selGround.prepSchedule?(
                <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                  {selGround.prepSchedule.split(".").filter(s=>s.trim()).map((step,i)=>(
                    <div key={i} style={{display:"flex",gap:"10px",alignItems:"flex-start",padding:"9px 12px",background:D.surf2,borderRadius:D.md}}>
                      <div style={{width:"22px",height:"22px",borderRadius:"50%",background:D.teal+"20",border:`1px solid ${D.teal}33`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <span style={{fontFamily:D.mono,fontSize:"10px",color:D.teal,fontWeight:700}}>{i+1}</span>
                      </div>
                      <span style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>{step.trim()}</span>
                    </div>
                  ))}
                </div>
              ):<div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>No preparation schedule set for this facility.</div>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export { FieldsView };
