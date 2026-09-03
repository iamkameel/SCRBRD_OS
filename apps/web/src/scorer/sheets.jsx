import { useState } from "react";
import { D } from "../design/tokens.js";
import { fmtOv } from "./format.js";
import { SHOT_CATEGORIES } from "./shots.js";
import { INT_TEAMS, ROLE_COLORS } from "./teams.js";
import { Badge, Btn, Lbl, Sep, Sheet } from "./ui.jsx";
import { Select } from "../ui/primitives.jsx";

/* ═══════════════════════════════════════════════════════
   SHOT SELECTOR SHEET
═══════════════════════════════════════════════════════ */
function ShotSelectorSheet({onSelect,onSkip,onClose}){
  const[sel,setSel]=useState(null);
  return (
    <Sheet title="Shot / Contact" accent={D.amber} onClose={onClose}>
      <div style={{paddingTop:"12px"}}>
        <div style={{color:D.textSecondary,fontSize:"12px",fontFamily:D.body,marginBottom:"14px"}}>
          Select the shot played or contact point for commentary
        </div>
        {SHOT_CATEGORIES.map(cat=>(
          <div key={cat.cat} style={{marginBottom:"14px"}}>
            <Lbl sx={{color:cat.color,marginBottom:"7px"}}>{cat.cat}</Lbl>
            <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
              {cat.shots.map(shot=>(
                <button key={shot.id} onClick={()=>setSel(shot.id)}
                  className={`pressBtn shotBtn${sel===shot.id?" active":""}`}
                  style={{padding:"6px 12px",borderRadius:D.pill,cursor:"pointer",
                    fontFamily:D.body,fontSize:"12px",fontWeight:500,
                    background:sel===shot.id?`${cat.color}20`:D.surf2,
                    color:sel===shot.id?cat.color:D.textSecondary}}>
                  {shot.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        <Sep sx={{margin:"14px 0"}}/>
        <div style={{display:"flex",gap:"10px"}}>
          <Btn variant="ghost" full onClick={onSkip} sx={{borderRadius:D.md}}>Skip</Btn>
          <Btn variant="amber" full disabled={!sel} onClick={()=>sel&&onSelect(sel)} sx={{borderRadius:D.md}}>
            Confirm Shot →
          </Btn>
        </div>
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════
   NO BALL SHEET — different rules for front foot vs height
═══════════════════════════════════════════════════════ */
function NoBallSheet({onConfirm,onClose}){
  const[nbType,setNbType]=useState("front_foot");
  const[runs,setRuns]=useState(0);
  // Front foot NB: batter CAN be caught (only bowled/LBW/hit wicket protected)
  // Height NB (above shoulder): same + extra restrictions
  // Both: 1 penalty run + any runs scored, bat gets credit, doesn't count as legal delivery
  const types=[
    {id:"front_foot",label:"Front Foot",sub:"Bowler overstepped the crease",
      note:"Batter can be dismissed caught, run out, stumped, handled ball, hit ball twice, obstructing field"},
    {id:"height",label:"Full Toss Height",sub:"Above waist height on the full",
      note:"Same dismissals as front foot. Free hit applies in limited overs."},
    {id:"beamer",label:"Beamer (Dangerous)",sub:"Full toss above waist — dangerous delivery",
      note:"Umpire warning issued. Bowler may be removed. Same dismissal rules apply."},
  ];
  return (
    <Sheet title="No Ball" accent={D.amber} onClose={onClose}>
      <div style={{paddingTop:"14px",display:"flex",flexDirection:"column",gap:"14px"}}>
        {types.map(t=>(
          <button key={t.id} onClick={()=>setNbType(t.id)} className="pressBtn" style={{
            padding:"12px 14px",borderRadius:D.md,cursor:"pointer",textAlign:"left",width:"100%",
            border:`1px solid ${nbType===t.id?D.amber+"66":D.border}`,
            background:nbType===t.id?`${D.amber}10`:D.surf2}}>
            <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:nbType===t.id?D.amber:D.textPrimary,marginBottom:"3px"}}>{t.label}</div>
            <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{t.sub}</div>
          </button>
        ))}
        {/* Dismissal note */}
        <div style={{background:`${D.amber}0a`,border:`1px solid ${D.amber}22`,borderRadius:D.md,padding:"10px 14px"}}>
          <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.amber,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"5px"}}>Dismissals Allowed</div>
          <div style={{color:D.textSecondary,fontSize:"11px",fontFamily:D.body,lineHeight:1.5}}>
            {types.find(t=>t.id===nbType)?.note}
          </div>
          {(nbType==="height"||nbType==="beamer")&&(
            <div style={{marginTop:"6px",color:D.orange,fontSize:"11px",fontFamily:D.body,fontWeight:500}}>
              ⚡ Free hit on next delivery (limited overs)
            </div>
          )}
        </div>
        {/* Runs off the no ball */}
        <div>
          <Lbl sx={{marginBottom:"8px"}}>Runs Scored Off This Ball</Lbl>
          <div style={{display:"flex",gap:"6px"}}>
            {[0,1,2,3,4,5,6].map(r=>(
              <button key={r} onClick={()=>setRuns(r)} className="pressBtn" style={{
                flex:1,padding:"11px 0",borderRadius:D.md,cursor:"pointer",
                fontFamily:D.mono,fontSize:"15px",fontWeight:500,
                border:`1px solid ${runs===r?D.amber+"77":D.border}`,
                background:runs===r?`${D.amber}1a`:D.surf2,
                color:runs===r?D.amber:D.textMuted,transition:"all .2s",
              }}>{r}</button>
            ))}
          </div>
          <div style={{marginTop:"6px",color:D.textMuted,fontSize:"11px",fontFamily:D.body}}>
            +1 penalty run added automatically. Total: <span style={{color:D.amber,fontFamily:D.mono,fontWeight:500}}>{runs+1}</span> runs to batting team.
          </div>
        </div>
        <Btn variant="amber" size="lg" full onClick={()=>onConfirm(nbType,runs)} sx={{borderRadius:D.md}}>
          Confirm No Ball ({runs+1} runs)
        </Btn>
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════
   PENALTY RUNS SHEET
═══════════════════════════════════════════════════════ */
function PenaltySheet({battingTeam,bowlingTeam,onConfirm,onClose}){
  const[runs,setRuns]=useState(5);
  const[to,setTo]=useState("batting");
  const[reason,setReason]=useState("");
  const reasons=["Ball hit helmet on field","Deliberate time wasting","Changing condition of ball","Ball hitting fielder's helmet on ground","Ball going into fielder's clothing","Dangerous/unfair play","Fielding restrictions violation","Other"];
  return (
    <Sheet title="Penalty Runs" accent={D.violet} onClose={onClose}>
      <div style={{paddingTop:"14px",display:"flex",flexDirection:"column",gap:"14px"}}>
        <div>
          <Lbl sx={{marginBottom:"8px"}}>Awarded To</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
            {[["batting","Batting Team",battingTeam],["bowling","Bowling Team",bowlingTeam]].map(([val,lbl,name])=>(
              <button key={val} onClick={()=>setTo(val)} className="pressBtn" style={{
                padding:"10px",borderRadius:D.md,cursor:"pointer",textAlign:"left",
                border:`1px solid ${to===val?D.violet+"66":D.border}`,
                background:to===val?`${D.violet}14`:D.surf2}}>
                <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:600,color:to===val?D.violet:D.textSecondary,marginBottom:"2px"}}>{lbl}</div>
                <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:500,color:to===val?D.textPrimary:D.textMuted}}>{name}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <Lbl sx={{marginBottom:"8px"}}>Runs</Lbl>
          <div style={{display:"flex",gap:"6px"}}>
            {[5,3,1].map(r=>(
              <button key={r} onClick={()=>setRuns(r)} className="pressBtn" style={{
                flex:1,padding:"12px 0",borderRadius:D.md,cursor:"pointer",
                fontFamily:D.mono,fontSize:"18px",fontWeight:500,
                border:`1px solid ${runs===r?D.violet+"66":D.border}`,
                background:runs===r?`${D.violet}1a`:D.surf2,
                color:runs===r?D.violet:D.textMuted,transition:"all .2s"}}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Lbl sx={{marginBottom:"8px"}}>Reason</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
            {reasons.map(r=>(
              <button key={r} onClick={()=>setReason(r)} className="pressBtn" style={{
                padding:"5px 10px",borderRadius:D.pill,cursor:"pointer",
                fontFamily:D.body,fontSize:"11px",fontWeight:500,
                border:`1px solid ${reason===r?D.violet+"55":D.border}`,
                background:reason===r?`${D.violet}14`:D.surf2,
                color:reason===r?D.violet:D.textMuted,transition:"all .15s"}}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <Btn variant="primary" full onClick={()=>onConfirm(runs,to,reason||"Penalty runs")} sx={{
          borderRadius:D.md,background:`linear-gradient(135deg,${D.violet},${D.indigo})`}}>
          Award {runs} Penalty Runs to {to==="batting"?battingTeam:bowlingTeam}
        </Btn>
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════
   BATTING ORDER MANAGER SHEET
═══════════════════════════════════════════════════════ */
// A squad entry is {id, name}. The demonstration fixtures carry bare strings,
// where the name IS the identity; a real one carries player UUIDs, because
// ball_event.striker_id is a foreign key into `player` and a name is not
// something a database can join on. Both shapes arrive here, so both are
// normalised at the door rather than being tested for at every use.
const entry = (p) => (typeof p === "string" ? { id: p, name: p } : { id: p?.id ?? p?.name, name: p?.name ?? p?.id });

function BattingOrderSheet({squad,batsmen,teamKey,twelfthMan,onSend,onClose}){
  const teamInfo=INT_TEAMS[teamKey]||null;
  const roster=(squad||[]).map(entry);
  const available=roster.filter(p=>{
    const played=batsmen.find(b=>b.id===p.id);
    return !played||(played.status==="dnb");
  });
  const getRoleInfo=(name)=>{
    if(!teamInfo)return null;
    return teamInfo.players.find(p=>p.name===name)||null;
  };
  const dismissed=batsmen.filter(b=>b.status==="out");
  const atCrease=batsmen.filter(b=>b.status==="batting");
  return (
    <Sheet title="Batting Order" accent={D.emerald} onClose={onClose}>
      <div style={{paddingTop:"12px"}}>
        {/* At crease */}
        {atCrease.length>0&&(
          <div style={{marginBottom:"12px"}}>
            <Lbl sx={{marginBottom:"7px",color:D.emerald}}>At Crease</Lbl>
            {atCrease.map(b=>{
              const ri=getRoleInfo(b.name);
              return (
                <div key={b.id} style={{display:"flex",alignItems:"center",gap:"10px",padding:"8px 12px",
                  background:`${D.emerald}0a`,border:`1px solid ${D.emerald}22`,borderRadius:D.md,marginBottom:"5px"}}>
                  <div className="liveDot" style={{width:"6px",height:"6px",borderRadius:"50%",background:D.emerald,flexShrink:0}}/>
                  <span style={{fontFamily:D.body,fontSize:"13px",fontWeight:500,color:D.textPrimary,flex:1}}>{b.name}</span>
                  {ri&&<Badge color={ROLE_COLORS[ri.role]} sx={{fontSize:"8px"}}>{ri.role}</Badge>}
                  <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textSecondary}}>{b.runs}({b.balls})</span>
                </div>
              );
            })}
          </div>
        )}
        {/* Available */}
        <Lbl sx={{marginBottom:"7px"}}>Available to Bat</Lbl>
        <div style={{display:"flex",flexDirection:"column",gap:"4px",marginBottom:"12px"}}>
          {available.map((p,i)=>{
            const ri=getRoleInfo(p.name);
            const pos=roster.findIndex(r=>r.id===p.id)+1;
            return (
              <button key={p.id} onClick={()=>onSend(p.id)} className="pressBtn" style={{
                display:"flex",alignItems:"center",gap:"10px",
                padding:"9px 12px",borderRadius:D.md,cursor:"pointer",textAlign:"left",width:"100%",
                border:`1px solid ${i===0?D.emerald+"44":D.border}`,
                background:i===0?`${D.emerald}0a`:D.surf2,transition:"all .15s",
              }}>
                <div style={{width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,
                  background:i===0?`${D.emerald}22`:D.surf3,
                  border:`1px solid ${i===0?D.emerald+"44":D.border}`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontFamily:D.mono,fontSize:"10px",fontWeight:600,
                  color:i===0?D.emerald:D.textMuted}}>
                  {pos}
                </div>
                <span style={{fontFamily:D.body,fontSize:"13px",fontWeight:i===0?600:400,
                  color:i===0?D.textPrimary:D.textSecondary,flex:1}}>{p.name}</span>
                {ri&&<Badge color={ROLE_COLORS[ri.role]} sx={{fontSize:"8px"}}>{ri.role}</Badge>}
                {i===0&&<Badge color={D.emerald} sx={{fontSize:"8px",marginLeft:"2px"}}>Next</Badge>}
              </button>
            );
          })}
          {available.length===0&&(
            <div style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px",padding:"12px",textAlign:"center"}}>
              All squad members have batted
            </div>
          )}
        </div>
        {/* 12th man info */}
        {twelfthMan&&(
          <div style={{marginBottom:"12px",padding:"9px 12px",
            background:`${D.violet}0a`,border:`1px solid ${D.violet}28`,borderRadius:D.md,
            display:"flex",alignItems:"center",gap:"10px"}}>
            <Badge color={D.violet} sx={{flexShrink:0}}>12th Man</Badge>
            <span style={{fontFamily:D.body,fontSize:"13px",color:D.textSecondary,flex:1}}>{twelfthMan}</span>
            <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>fielding sub only</span>
          </div>
        )}
        {/* Dismissed */}
        {dismissed.length>0&&(
          <details style={{marginBottom:"12px"}}>
            <summary style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.12em",
              textTransform:"uppercase",color:D.textMuted,cursor:"pointer",marginBottom:"7px"}}>
              Dismissed ({dismissed.length})
            </summary>
            <div style={{display:"flex",flexDirection:"column",gap:"4px",paddingTop:"6px"}}>
              {dismissed.map(b=>(
                <div key={b.id} style={{display:"flex",alignItems:"center",gap:"10px",padding:"6px 10px",
                  borderRadius:D.md,background:`${D.rose}08`,border:`1px solid ${D.rose}15`}}>
                  <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,flex:1}}>{b.name}</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.rose}}>{b.runs}({b.balls})</span>
                </div>
              ))}
            </div>
          </details>
        )}
        <Sep sx={{marginBottom:"12px"}}/>
        <CustomBatEntry onSend={onSend}/>
      </div>
    </Sheet>
  );
}

function CustomBatEntry({onSend}){
  const[name,setName]=useState("");
  return (
    <div>
      <Lbl sx={{marginBottom:"7px",color:D.textMuted}}>Or Enter Unlisted Player</Lbl>
      <div style={{display:"flex",gap:"8px"}}>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Player name…"
          style={{flex:1,background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
            color:D.textPrimary,fontSize:"14px",fontFamily:D.body,fontWeight:500,padding:"10px 14px",outline:"none"}}
          onKeyDown={e=>{if(e.key==="Enter"&&name.trim())onSend(name.trim());}}/>
        <Btn variant="live" disabled={!name.trim()} onClick={()=>name.trim()&&onSend(name.trim())} sx={{borderRadius:D.md,padding:"10px 18px"}}>Go</Btn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   WICKET SHEET
═══════════════════════════════════════════════════════ */
function WicketSheet({batName,fieldingSquad,onClose,onConfirm}){
  const[mode,setMode]=useState("Bowled");
  const[fielder,setFielder]=useState("");
  const[fielterFilter,setFielderFilter]=useState("");
  const modes=["Bowled","Caught","LBW","Run Out","Stumped","Hit Wicket","Handled Ball","Obstructed Field"];
  const needsFielder=mode==="Caught"||mode==="Run Out";
  const isStumped=mode==="Stumped";
  // Find WK from fielding squad
  const wkName=(fieldingSquad||[]).find(p=>p.role==="WK")?.name||null;
  // Auto-assign WK for stumped
  const displayFielder=isStumped?wkName||fielder:fielder;
  const filteredFielders=(fieldingSquad||[])
    .filter(p=>!fielterFilter||p.name.toLowerCase().includes(fielterFilter.toLowerCase()));
  const handleMode=(m)=>{
    setMode(m);
    setFielder("");
    setFielderFilter("");
    if(m==="Stumped"&&wkName)setFielder(wkName);
  };
  return (
    <Sheet title="WICKET!" accent={D.rose} onClose={onClose}>
      <div style={{color:D.textSecondary,fontSize:"13px",fontFamily:D.body,marginBottom:"14px",paddingTop:"4px"}}>
        {batName} is dismissed
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px",marginBottom:"14px"}}>
        {modes.map(m=>(
          <button key={m} onClick={()=>handleMode(m)} className="pressBtn" style={{
            padding:"11px",borderRadius:D.md,cursor:"pointer",fontFamily:D.body,fontSize:"13px",fontWeight:500,
            border:"1px solid "+(mode===m?D.rose+"55":D.border),
            background:mode===m?D.rose+"1a":D.surf2,
            color:mode===m?"#fca5a5":D.textSecondary,transition:"all .15s"}}>
            {m}
          </button>
        ))}
      </div>
      {isStumped&&(
        <div style={{marginBottom:"12px",padding:"10px 13px",borderRadius:D.md,
          background:D.violet+"0e",border:"1px solid "+D.violet+"33"}}>
          <Lbl sx={{marginBottom:"4px",color:D.violet}}>Wicketkeeper</Lbl>
          <div style={{fontFamily:D.body,fontSize:"13px",color:D.textPrimary,fontWeight:500}}>
            {wkName||"—"}
            {wkName&&<span style={{color:D.textMuted,fontSize:"11px",marginLeft:"6px"}}>(auto-assigned)</span>}
          </div>
        </div>
      )}
      {needsFielder&&fieldingSquad&&fieldingSquad.length>0&&(
        <div style={{marginBottom:"12px"}}>
          <Lbl sx={{marginBottom:"8px"}}>{mode==="Caught"?"Caught by":"Run out by"}</Lbl>
          <input value={fielterFilter} onChange={e=>setFielderFilter(e.target.value)}
            placeholder="Search fielder…"
            style={{width:"100%",background:D.surf2,border:"1px solid "+D.border,borderRadius:D.md,
              color:D.textPrimary,fontSize:"13px",fontFamily:D.body,padding:"9px 13px",outline:"none",marginBottom:"8px"}}/>
          <div style={{display:"flex",flexDirection:"column",gap:"4px",maxHeight:"180px",overflowY:"auto"}}>
            {filteredFielders.map(p=>(
              <button key={p.name} onClick={()=>setFielder(p.name)} className="pressBtn" style={{
                display:"flex",alignItems:"center",gap:"8px",padding:"8px 12px",borderRadius:D.md,
                border:"1px solid "+(fielder===p.name?D.sky+"55":D.border),
                background:fielder===p.name?D.sky+"12":D.surf2,
                cursor:"pointer",textAlign:"left",transition:"all .12s"}}>
                <span style={{fontFamily:D.body,fontSize:"13px",color:fielder===p.name?D.sky:D.textPrimary,fontWeight:500,flex:1}}>{p.name}</span>
                <Badge color={p.role==="WK"?D.violet:p.role==="ALL"?D.amber:p.role==="BOWL"?D.orange:D.sky} sx={{fontSize:"8px"}}>{p.role}</Badge>
              </button>
            ))}
          </div>
          {!fielder&&<div style={{fontFamily:D.body,fontSize:"11px",color:D.amber,marginTop:"6px"}}>Or type name below:</div>}
          <input value={!fieldingSquad.find(p=>p.name===fielder)&&fielder?fielder:""} 
            onChange={e=>setFielder(e.target.value)} placeholder="Type any name…"
            style={{width:"100%",background:D.surf2,border:"1px solid "+D.border,borderRadius:D.md,marginTop:"6px",
              color:D.textPrimary,fontSize:"13px",fontFamily:D.body,padding:"9px 13px",outline:"none"}}/>
        </div>
      )}
      {needsFielder&&(!fieldingSquad||!fieldingSquad.length)&&(
        <div style={{marginBottom:"12px"}}>
          <Lbl sx={{marginBottom:"7px"}}>{mode==="Caught"?"Caught by":"Run out by"}</Lbl>
          <input value={fielder} onChange={e=>setFielder(e.target.value)} placeholder="Fielder name (optional)"
            style={{width:"100%",background:D.surf2,border:"1px solid "+D.border,borderRadius:D.md,
              color:D.textPrimary,fontSize:"13px",fontFamily:D.body,padding:"11px 14px",outline:"none"}}/>
        </div>
      )}
      <div style={{display:"flex",gap:"10px",marginTop:"4px"}}>
        <Btn variant="ghost" sx={{flex:1,borderRadius:D.md}} onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" sx={{flex:2,borderRadius:D.md}} onClick={()=>onConfirm(mode,displayFielder)}>Confirm Out</Btn>
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════
   NEW OVER / BOWLER SHEET
═══════════════════════════════════════════════════════ */
function NewOverSheet({ovNum,prevBowlers,bowlingSquad,bowlingTeamKey,lastBowlerName,onClose,onConfirm}){
  const[name,setName]=useState("");
  const[filter,setFilter]=useState("");
  const teamInfo=INT_TEAMS[bowlingTeamKey]||null;
  // Build full list: team bowlers first, then all-rounders, then others
  // Same normalisation as the batting sheet: a demonstration squad is bare
  // strings, a real one is {id, name} with player UUIDs, and what goes into the
  // event has to be the id either way.
  const allBowlers=teamInfo
    ? teamInfo.players.filter(p=>p.bowl).map(p=>({...p,id:p.id??p.name}))
    : (bowlingSquad||[]).map(n=>({...entry(n),role:"BOWL"}));
  const filtered=filter
    ? allBowlers.filter(p=>p.name.toLowerCase().includes(filter.toLowerCase()))
    : allBowlers;
  const prevNames=new Set(prevBowlers.map(b=>b.name));
  // Can't bowl consecutive overs. Compared by NAME because that is what the
  // caller has to hand for the previous bowler; ids are what get emitted.
  const canBowl=(pname)=>pname!==lastBowlerName;
  const prevBowlerMap={};
  prevBowlers.forEach(b=>{prevBowlerMap[b.name]=b;});
  return (
    <Sheet title={ovNum===0?"Opening Bowler":`Over ${ovNum} Complete`} accent={D.amber} onClose={onClose}>
      <div style={{paddingTop:"8px"}}>
        <div style={{color:D.textSecondary,fontSize:"12px",fontFamily:D.body,marginBottom:"14px"}}>
          {ovNum===0?"Select the opening bowler.":`Select bowler for over ${ovNum+1}.`}
          {lastBowlerName&&<span style={{color:D.textMuted}}> ({lastBowlerName} cannot bowl consecutive overs)</span>}
        </div>
        {/* Search filter */}
        <div style={{marginBottom:"12px"}}>
          <input value={filter} onChange={e=>setFilter(e.target.value)}
            placeholder="Search bowler…"
            style={{width:"100%",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
              color:D.textPrimary,fontSize:"14px",fontFamily:D.body,padding:"9px 14px",outline:"none"}}
            onFocus={e=>e.target.style.borderColor=D.amber+"66"}
            onBlur={e=>e.target.style.borderColor=D.border}/>
        </div>
        {/* Previously bowled this innings — quick pick */}
        {prevBowlers.length>0&&(
          <div style={{marginBottom:"12px"}}>
            <Lbl sx={{marginBottom:"7px",color:D.amber}}>Already Bowled This Innings</Lbl>
            <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
              {prevBowlers.map(b=>{
                const dis=!canBowl(b.name);
                const ri=teamInfo?.players.find(p=>p.name===b.name);
                return (
                  <button key={b.id} onClick={()=>!dis&&onConfirm(b.id)} disabled={dis} className="pressBtn" style={{
                    display:"flex",alignItems:"center",gap:"10px",padding:"9px 12px",
                    borderRadius:D.md,cursor:dis?"not-allowed":"pointer",textAlign:"left",width:"100%",
                    border:`1px solid ${dis?D.border:D.amber+"33"}`,
                    background:dis?`${D.surf2}55`:`${D.amber}08`,opacity:dis?0.45:1,
                  }}>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:500,
                        color:dis?D.textMuted:D.textPrimary}}>{b.name}</div>
                      {dis&&<div style={{fontFamily:D.body,fontSize:"10px",color:D.rose,marginTop:"1px"}}>Cannot bowl consecutive overs</div>}
                    </div>
                    {ri&&<Badge color={ROLE_COLORS[ri.role]} sx={{fontSize:"8px"}}>{ri.role}</Badge>}
                    <div style={{display:"flex",gap:"12px",alignItems:"center"}}>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textSecondary}}>{fmtOv(b.balls)} ov</div>
                        <div style={{fontFamily:D.mono,fontSize:"11px",color:b.wickets>0?D.rose:D.textMuted}}>{b.runs}r {b.wickets}w</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {/* Full bowling roster */}
        <Lbl sx={{marginBottom:"7px",color:D.textMuted}}>
          {teamInfo?`${bowlingTeamKey} — Bowling Options`:bowlingSquad?.length?"Fielding Squad":"New Bowler"}
        </Lbl>
        <div style={{display:"flex",flexDirection:"column",gap:"4px",marginBottom:"14px",maxHeight:"280px",overflowY:"auto"}}>
          {filtered.map(player=>{
            const alreadyBowled=prevBowlerMap[player.name];
            const dis=!canBowl(player.name);
            const rc=ROLE_COLORS[player.role]||D.orange;
            return (
              <button key={player.id??player.name} onClick={()=>!dis&&onConfirm(player.id??player.name)} disabled={dis} className="pressBtn" style={{
                display:"flex",alignItems:"center",gap:"10px",padding:"9px 12px",
                borderRadius:D.md,cursor:dis?"not-allowed":"pointer",textAlign:"left",width:"100%",
                border:`1px solid ${dis?D.border:alreadyBowled?D.amber+"22":D.border}`,
                background:dis?`${D.surf2}55`:alreadyBowled?`${D.amber}06`:D.surf2,
                opacity:dis?0.4:1,transition:"all .15s",
              }}>
                <span style={{fontFamily:D.body,fontSize:"13px",fontWeight:alreadyBowled?600:400,
                  color:dis?D.textMuted:D.textPrimary,flex:1}}>{player.name}</span>
                <Badge color={rc} sx={{fontSize:"8px"}}>{player.role}</Badge>
                {alreadyBowled&&(
                  <div style={{textAlign:"right",marginLeft:"6px"}}>
                    <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{fmtOv(alreadyBowled.balls)}ov {alreadyBowled.runs}r{alreadyBowled.wickets>0?` ${alreadyBowled.wickets}w`:""}</div>
                  </div>
                )}
              </button>
            );
          })}
          {filtered.length===0&&(
            <div style={{color:D.textMuted,fontSize:"13px",fontFamily:D.body,padding:"12px",textAlign:"center"}}>
              No bowlers match "{filter}"
            </div>
          )}
        </div>
        {/* Manual entry fallback */}
        <Sep sx={{marginBottom:"12px"}}/>
        <Lbl sx={{marginBottom:"7px",color:D.textMuted}}>Or Type Name</Lbl>
        <div style={{display:"flex",gap:"8px"}}>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Bowler name…"
            style={{flex:1,background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
              color:D.textPrimary,fontSize:"14px",fontFamily:D.body,fontWeight:500,padding:"10px 14px",outline:"none"}}
            onFocus={e=>e.target.style.borderColor=D.amber+"66"} onBlur={e=>e.target.style.borderColor=D.border}
            onKeyDown={e=>{if(e.key==="Enter"&&name.trim())onConfirm(name.trim());}}/>
          <Btn variant="amber" disabled={!name.trim()} onClick={()=>name.trim()&&onConfirm(name.trim())} sx={{borderRadius:D.md,padding:"10px 18px"}}>Go</Btn>
        </div>
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════
   INNINGS BREAK SHEET
═══════════════════════════════════════════════════════ */
function Innings2Sheet({target,teamName,overs,onClose,onStart}){
  return (
    <Sheet title="Innings Break" accent={D.indigo} onClose={onClose}>
      <div style={{textAlign:"center",padding:"20px 0 24px"}}>
        <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted,marginBottom:"8px"}}>{teamName} need</div>
        <div style={{fontFamily:D.mono,fontSize:"clamp(56px,12vw,80px)",fontWeight:500,
          background:D.grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",
          lineHeight:1,letterSpacing:"-0.02em",marginBottom:"6px"}}>{target}</div>
        <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted,marginBottom:"24px"}}>runs to win in {overs} overs</div>
        <Btn variant="primary" size="lg" sx={{borderRadius:D.md,minWidth:"220px"}} onClick={onStart}>Start 2nd Innings →</Btn>
      </div>
    </Sheet>
  );
}

export { BattingOrderSheet, CustomBatEntry, Innings2Sheet, NewOverSheet, NoBallSheet, PenaltySheet, ShotSelectorSheet, WicketSheet };
