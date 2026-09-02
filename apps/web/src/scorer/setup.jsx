import { useState, useRef } from "react";
import { D } from "../design/tokens.js";
import { SCRBRD } from "./engine.jsx";
import { INT_TEAMS, ROLE_COLORS } from "./teams.js";
import { Badge, Btn, GS, Glass, Lbl } from "./ui.jsx";
import { Select } from "../ui/primitives.jsx";

/* ═══════════════════════════════════════════════════════
   OPENING SETUP STEP  (step 4 of SetupScreen)
   Batting order → select 2 openers → select opening bowler
═══════════════════════════════════════════════════════ */
function OpeningSetupStep({batKey,bowlKey,batOrder,setBatOrder,bowlingSquad,bowlingTeamKey,onConfirm}){
  const[subStep,setSubStep]=useState(0); // 0=bat order, 1=openers, 2=bowler
  const[dragging,setDragging]=useState(null);const[dragOver,setDragOver]=useState(null);
  const[opener1,setOpener1]=useState(null);
  const[opener2,setOpener2]=useState(null);
  const[bowler,setBowler]=useState(null);
  const[bowlerFilter,setBowlerFilter]=useState("");
  const batTeam=INT_TEAMS[batKey];
  const bowlTeam=INT_TEAMS[bowlKey];
  const getPlayer=(name)=>batTeam?.players.find(p=>p.name===name)||null;
  const getBowler=(name)=>bowlTeam?.players.find(p=>p.name===name)||null;

  // Drag handlers for batting order
  const onDragStart=(i)=>setDragging(i);
  const onDragEnter=(i)=>setDragOver(i);
  const onDragEnd=()=>{
    if(dragging==null||dragOver==null||dragging===dragOver){setDragging(null);setDragOver(null);return;}
    const next=[...batOrder];const[moved]=next.splice(dragging,1);next.splice(dragOver,0,moved);
    setBatOrder(next);setDragging(null);setDragOver(null);
  };

  const bowlerCandidates=(bowlingSquad||[]).filter(n=>{
    const p=getBowler(n);
    if(!p)return true; // custom player — include
    return p.bowl!==false; // only bowlers
  }).filter(n=>!bowlerFilter||n.toLowerCase().includes(bowlerFilter.toLowerCase()));

  const SUBSTEP_LABELS=["Batting Order","Openers","Opening Bowler"];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      {/* Sub-step tabs */}
      <div style={{display:"flex",gap:"4px"}}>
        {SUBSTEP_LABELS.map((l,i)=>(
          <div key={i} style={{flex:1,textAlign:"center",padding:"7px 4px",borderRadius:D.md,cursor:i<subStep?"pointer":"default",
            background:i===subStep?D.indigo+"20":i<subStep?D.emerald+"10":"transparent",
            border:`1px solid ${i===subStep?D.indigo+"55":i<subStep?D.emerald+"33":D.border}`,
            fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",
            color:i===subStep?D.sky:i<subStep?D.emerald:D.textMuted,transition:"all .2s",
          }} onClick={()=>i<subStep&&setSubStep(i)}>
            {i<subStep?"✓ ":""}{l}
          </div>
        ))}
      </div>

      {/* Sub-step 0: Batting order */}
      {subStep===0&&(
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
            <span style={{fontSize:"20px"}}>{batTeam?.flag}</span>
            <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>{batKey}</div>
            <Lbl sx={{color:D.amber}}>Batting First</Lbl>
          </div>
          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>
            Drag to set your batting order. Openers (1 & 2) are highlighted.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"3px"}}>
            {batOrder.map((name,i)=>{
              const p=getPlayer(name);
              const rc=p?ROLE_COLORS[p.role]||D.textMuted:D.textMuted;
              const isDraggingThis=dragging===i;
              const isDragTarget=dragOver===i&&dragging!==i;
              const isOpener=i<2;
              return (
                <div key={name} draggable onDragStart={()=>onDragStart(i)}
                  onDragEnter={()=>onDragEnter(i)} onDragOver={e=>e.preventDefault()} onDragEnd={onDragEnd}
                  style={{display:"flex",alignItems:"center",gap:"9px",padding:"9px 11px",borderRadius:D.md,
                    background:isDraggingThis?`${D.sky}18`:isDragTarget?`${D.indigo}14`:isOpener?`${D.emerald}09`:D.surf2,
                    border:`1px solid ${isDraggingThis?D.sky+"66":isDragTarget?D.indigo+"44":isOpener?D.emerald+"33":D.border}`,
                    cursor:"grab",userSelect:"none",
                    opacity:isDraggingThis?0.6:1,transition:"all .12s",
                    boxShadow:isDragTarget?`0 0 0 2px ${D.indigo}44`:"none",
                  }}>
                  <span style={{color:D.textMuted,fontSize:"14px",cursor:"grab",flexShrink:0}}>⠿</span>
                  <div style={{width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                    fontFamily:D.mono,fontSize:"10px",fontWeight:600,
                    background:isOpener?`${D.emerald}20`:D.surf3,
                    color:isOpener?D.emerald:D.textMuted,
                    border:`1px solid ${isOpener?D.emerald+"44":D.border}`}}>
                    {i+1}
                  </div>
                  <span style={{flex:1,fontFamily:D.body,fontSize:"13px",fontWeight:isOpener?600:400,color:D.textPrimary}}>{name}</span>
                  {p&&(
                    <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
                      {/* Handedness badges */}
                      <span style={{fontFamily:D.mono,fontSize:"9px",fontWeight:700,padding:"1px 5px",borderRadius:D.pill,
                        background:p.batHand==="L"?`${D.amber}15`:`${D.sky}15`,
                        border:`1px solid ${p.batHand==="L"?D.amber+"33":D.sky+"33"}`,
                        color:p.batHand==="L"?D.amber:D.sky}}>{p.batHand}HB</span>
                      <Badge color={rc} sx={{fontSize:"8px"}}>{p.role}</Badge>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <Btn variant="primary" size="lg" full onClick={()=>setSubStep(1)} sx={{borderRadius:D.md}}>
            Confirm Order → Select Openers
          </Btn>
        </div>
      )}

      {/* Sub-step 1: Select 2 openers */}
      {subStep===1&&(
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>
            {!opener1?"Tap to select Striker (facing first ball)":!opener2?"Tap to select Non-Striker":"Both openers set ✓"}
          </div>
          <div style={{display:"flex",gap:"8px",marginBottom:"4px"}}>
            {[{label:"Striker",val:opener1,col:D.emerald},{label:"Non-Striker",val:opener2,col:D.sky}].map(({label,val,col})=>(
              <div key={label} style={{flex:1,padding:"10px",borderRadius:D.md,border:`1px solid ${val?col+"55":D.border}`,
                background:val?`${col}0e`:D.surf2,textAlign:"center"}}>
                <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:val?col:D.textMuted,marginBottom:"4px"}}>{label}</div>
                <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:val?D.textPrimary:D.textMuted}}>{val||"—"}</div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"3px"}}>
            {batOrder.map((name,i)=>{
              const p=getPlayer(name);
              const rc=p?ROLE_COLORS[p.role]||D.textMuted:D.textMuted;
              const isSelected=opener1===name||opener2===name;
              const isO1=opener1===name,isO2=opener2===name;
              return (
                <button key={name} onClick={()=>{
                  if(opener1===name){setOpener1(null);return;}
                  if(opener2===name){setOpener2(null);return;}
                  if(!opener1){setOpener1(name);return;}
                  if(!opener2){setOpener2(name);}
                }} className="pressBtn" style={{
                  display:"flex",alignItems:"center",gap:"9px",padding:"9px 11px",borderRadius:D.md,cursor:"pointer",
                  textAlign:"left",width:"100%",
                  border:`1px solid ${isO1?D.emerald+"55":isO2?D.sky+"55":D.border}`,
                  background:isO1?`${D.emerald}0e`:isO2?`${D.sky}0e`:D.surf2,
                  transition:"all .15s",
                }}>
                  <div style={{width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                    fontFamily:isSelected?"Syne":"DM Mono",fontSize:isSelected?"10px":"10px",fontWeight:700,
                    background:isO1?`${D.emerald}22`:isO2?`${D.sky}22`:D.surf3,
                    color:isO1?D.emerald:isO2?D.sky:D.textMuted,
                    border:`1px solid ${isO1?D.emerald+"55":isO2?D.sky+"55":D.border}`}}>
                    {isO1?"S":isO2?"N":i+1}
                  </div>
                  <span style={{flex:1,fontFamily:D.body,fontSize:"13px",fontWeight:isSelected?600:400,
                    color:isSelected?D.textPrimary:D.textSecondary}}>{name}</span>
                  {p&&(
                    <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
                      <span style={{fontFamily:D.mono,fontSize:"9px",fontWeight:700,padding:"1px 5px",borderRadius:D.pill,
                        background:p.batHand==="L"?`${D.amber}15`:`${D.sky}15`,
                        border:`1px solid ${p.batHand==="L"?D.amber+"33":D.sky+"33"}`,
                        color:p.batHand==="L"?D.amber:D.sky}}>{p.batHand}HB</span>
                      <Badge color={rc} sx={{fontSize:"8px"}}>{p.role}</Badge>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <Btn variant="primary" size="lg" full disabled={!opener1||!opener2}
            onClick={()=>opener1&&opener2&&setSubStep(2)} sx={{borderRadius:D.md}}>
            {opener1&&opener2?"Select Opening Bowler →":"Select both openers first"}
          </Btn>
        </div>
      )}

      {/* Sub-step 2: Opening bowler */}
      {subStep===2&&(
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
            <span style={{fontSize:"20px"}}>{bowlTeam?.flag}</span>
            <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>{bowlKey}</div>
            <Lbl sx={{color:D.rose}}>Opening Bowler</Lbl>
          </div>
          {/* Filter input */}
          <input value={bowlerFilter} onChange={e=>setBowlerFilter(e.target.value)}
            placeholder="Filter bowlers…"
            style={{background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
              color:D.textPrimary,fontSize:"13px",fontFamily:D.body,padding:"8px 12px",outline:"none",width:"100%"}}/>
          <div style={{display:"flex",flexDirection:"column",gap:"3px",maxHeight:"300px",overflowY:"auto"}}>
            {bowlerCandidates.map(name=>{
              const p=getBowler(name);
              const rc=p?ROLE_COLORS[p.role]||D.textMuted:D.textMuted;
              const isSel=bowler===name;
              const styleDesc=p?`${p.bowlArm==="L"?"LA":"RA"}${p.bowlStyle==="F"?"F":p.bowlStyle==="S"?"S":"M"}`:"";
              return (
                <button key={name} onClick={()=>setBowler(name)} className="pressBtn" style={{
                  display:"flex",alignItems:"center",gap:"9px",padding:"9px 11px",borderRadius:D.md,
                  cursor:"pointer",textAlign:"left",width:"100%",
                  border:`1px solid ${isSel?D.rose+"55":D.border}`,
                  background:isSel?`${D.rose}0e`:D.surf2,transition:"all .15s",
                }}>
                  <div style={{width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                    fontFamily:D.mono,fontSize:"10px",fontWeight:700,
                    background:isSel?`${D.rose}22`:D.surf3,
                    color:isSel?D.rose:D.textMuted,
                    border:`1px solid ${isSel?D.rose+"55":D.border}`}}>
                    {isSel?"✓":"B"}
                  </div>
                  <span style={{flex:1,fontFamily:D.body,fontSize:"13px",fontWeight:isSel?600:400,
                    color:isSel?D.textPrimary:D.textSecondary}}>{name}</span>
                  {p&&(
                    <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
                      {styleDesc&&<span style={{fontFamily:D.mono,fontSize:"9px",fontWeight:700,padding:"1px 5px",borderRadius:D.pill,
                        background:`${D.violet}15`,border:`1px solid ${D.violet}33`,color:D.violet}}>{styleDesc}</span>}
                      <Badge color={rc} sx={{fontSize:"8px"}}>{p.role}</Badge>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <Btn variant="primary" size="lg" full disabled={!bowler}
            onClick={()=>bowler&&onConfirm(opener1,opener2,bowler)} sx={{borderRadius:D.md}}>
            {bowler?`Start Match — ${bowler} to bowl →`:"Select opening bowler first"}
          </Btn>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   TEAM SELECTOR COMPONENT (top-level)
═══════════════════════════════════════════════════════ */
function TeamSelector({value, onChange, accent, label}){
  const[open,setOpen]=useState(false);
  const selected=INT_TEAMS[value];
  return (
    <div style={{position:"relative"}}>
      <Lbl sx={{marginBottom:"8px"}}>{label}</Lbl>
      <button onClick={()=>setOpen(p=>!p)} className="pressBtn" style={{
        width:"100%",padding:"12px 16px",borderRadius:D.md,cursor:"pointer",
        background:D.surf2,border:`1px solid ${selected?accent+"55":D.border}`,
        display:"flex",alignItems:"center",gap:"10px",transition:"all .2s",
        boxShadow:selected?`0 0 16px ${accent}10`:"none",
      }}>
        {selected
          ?<><span style={{fontSize:"20px",lineHeight:1}}>{selected.flag}</span>
            <div style={{flex:1,textAlign:"left"}}>
              <div style={{fontFamily:D.body,fontSize:"14px",fontWeight:600,color:D.textPrimary}}>{value}</div>
              <div style={{fontFamily:D.mono,fontSize:"10px",color:accent}}>{selected.abbr}</div>
            </div></>
          :<span style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,flex:1,textAlign:"left"}}>Select team…</span>
        }
        <span style={{color:D.textMuted,fontSize:"12px",transform:open?"rotate(180deg)":"none",transition:"transform .2s"}}>▾</span>
      </button>
      {open&&(
        <div className="fadeIn" style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,zIndex:300,
          background:D.glass,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",
          border:`1px solid ${D.borderMed}`,borderRadius:D.lg,overflow:"hidden",
          boxShadow:"0 24px 60px rgba(0,0,0,.7)"}}>
          <div style={{maxHeight:"260px",overflow:"auto"}}>
            {Object.entries(INT_TEAMS).map(([name,info])=>(
              <button key={name} onClick={()=>{onChange(name);setOpen(false);}} className="pressBtn" style={{
                width:"100%",padding:"10px 14px",background:value===name?`${accent}12`:"transparent",
                border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:"10px",
                borderBottom:`1px solid ${D.border}`,transition:"background .15s",
              }}>
                <span style={{fontSize:"18px",lineHeight:1}}>{info.flag}</span>
                <span style={{fontFamily:D.body,fontSize:"13px",fontWeight:value===name?600:400,
                  color:value===name?D.textPrimary:D.textSecondary,flex:1,textAlign:"left"}}>{name}</span>
                <span style={{fontFamily:D.mono,fontSize:"10px",color:value===name?accent:D.textMuted}}>{info.abbr}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SQUAD BUILDER — 15 players, select 11 + 12th man
═══════════════════════════════════════════════════════ */
function SquadBuilder({teamKey, selected11, setSelected11, twelfthMan, setTwelfthMan, battingOrder, setBattingOrder}){
  const team=INT_TEAMS[teamKey];
  if(!team)return null;
  const accent=team.accent||D.sky;
  const dragIdx=useRef(null);
  const dragOverIdx=useRef(null);
  const[dragging,setDragging]=useState(null);
  const[dragOver,setDragOver]=useState(null);

  const toggle=(playerName)=>{
    const inXI=selected11.includes(playerName);
    const is12th=twelfthMan===playerName;
    if(is12th){setTwelfthMan(null);return;}
    if(inXI){
      setSelected11(selected11.filter(n=>n!==playerName));
      setBattingOrder(battingOrder.filter(n=>n!==playerName));
    } else if(selected11.length<11){
      setSelected11([...selected11,playerName]);
      setBattingOrder([...battingOrder.filter(n=>n!==playerName),playerName]);
    }
  };

  const setAs12th=(playerName,e)=>{
    e.stopPropagation();
    if(selected11.includes(playerName))return;
    setTwelfthMan(p=>p===playerName?null:playerName);
  };

  // Drag handlers for batting order
  const onDragStart=(idx)=>{dragIdx.current=idx;setDragging(idx);};
  const onDragEnter=(idx)=>{dragOverIdx.current=idx;setDragOver(idx);};
  const onDragEnd=()=>{
    const from=dragIdx.current;const to=dragOverIdx.current;
    if(from!==null&&to!==null&&from!==to){
      const newOrder=[...battingOrder];
      const [moved]=newOrder.splice(from,1);
      newOrder.splice(to,0,moved);
      setBattingOrder(newOrder);
    }
    dragIdx.current=null;dragOverIdx.current=null;
    setDragging(null);setDragOver(null);
  };

  const xi=selected11.length;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      <div style={{display:"flex",gap:"8px",alignItems:"center",flexWrap:"wrap"}}>
        <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,
          color:xi===11?D.emerald:xi>11?D.rose:D.amber}}>{xi}/11 selected</div>
        {twelfthMan&&<Badge color={D.violet}>12th: {twelfthMan.split(" ").pop()}</Badge>}
        {xi===11&&!twelfthMan&&<span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>select a 12th man below</span>}
        {xi===11&&twelfthMan&&<Badge color={D.emerald}>Squad complete ✓</Badge>}
        <button onClick={()=>{
          const auto=team.players.slice(0,11).map(p=>p.name);
          setSelected11(auto);setBattingOrder(auto);setTwelfthMan(team.players[11]?.name||null);
        }} className="pressBtn" style={{marginLeft:"auto",padding:"4px 10px",borderRadius:D.pill,
          border:`1px solid ${D.border}`,background:"transparent",cursor:"pointer",
          fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Auto-pick XI</button>
      </div>
      {/* Player list */}
      <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
        {team.players.map((player,i)=>{
          const inXI=selected11.includes(player.name);
          const is12th=twelfthMan===player.name;
          const xiPos=inXI?selected11.indexOf(player.name):-1;
          const rc=ROLE_COLORS[player.role]||D.textMuted;
          return (
            <button key={player.name} onClick={()=>toggle(player.name)} className="pressBtn" style={{
              display:"flex",alignItems:"center",gap:"10px",padding:"9px 12px",
              borderRadius:D.md,cursor:"pointer",textAlign:"left",width:"100%",
              border:`1px solid ${inXI?accent+"44":is12th?D.violet+"44":D.border}`,
              background:inXI?`${accent}0e`:is12th?`${D.violet}0e`:`${D.surf2}88`,
              transition:"all .15s",
              opacity:(!inXI&&!is12th&&xi>=11)?0.4:1,
            }}>
              <div style={{width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,
                background:inXI?`${accent}20`:is12th?`${D.violet}20`:D.surf3,
                border:`1px solid ${inXI?accent+"44":is12th?D.violet+"44":D.border}`,
                display:"flex",alignItems:"center",justifyContent:"center",
                fontFamily:D.mono,fontSize:"10px",fontWeight:600,
                color:inXI?accent:is12th?D.violet:D.textMuted}}>
                {inXI?xiPos+1:is12th?"12":"·"}
              </div>
              <span style={{flex:1,fontFamily:D.body,fontSize:"13px",fontWeight:inXI?600:400,
                color:inXI?D.textPrimary:D.textSecondary}}>{player.name}</span>
              <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                <Badge color={rc} sx={{fontSize:"8px",padding:"2px 6px"}}>{player.role}</Badge>
                {!inXI&&(
                  <button onClick={e=>setAs12th(player.name,e)} className="pressBtn" style={{
                    padding:"3px 8px",borderRadius:D.pill,border:`1px solid ${is12th?D.violet+"55":D.border}`,
                    background:is12th?`${D.violet}18`:"transparent",cursor:"pointer",
                    fontFamily:D.head,fontSize:"8px",fontWeight:700,color:is12th?D.violet:D.textMuted,
                    letterSpacing:"0.06em"}}>12th</button>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {/* Batting order — drag to reorder */}
      {battingOrder.length>0&&(
        <div style={{marginTop:"4px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}}>
            <Lbl sx={{color:accent}}>Batting Order</Lbl>
            <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>≡ drag to reorder</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"3px"}}>
            {battingOrder.map((name,i)=>{
              const isDraggingThis=dragging===i;
              const isDragTarget=dragOver===i&&dragging!==i;
              const ri=team.players.find(p=>p.name===name);
              const rc=ri?ROLE_COLORS[ri.role]||D.textMuted:D.textMuted;
              return (
                <div
                  key={name}
                  draggable
                  onDragStart={()=>onDragStart(i)}
                  onDragEnter={()=>onDragEnter(i)}
                  onDragOver={e=>e.preventDefault()}
                  onDragEnd={onDragEnd}
                  style={{
                    display:"flex",alignItems:"center",gap:"8px",padding:"8px 10px",
                    borderRadius:D.md,
                    background:isDraggingThis?`${accent}18`:isDragTarget?`${accent}12`:D.surf2,
                    border:`1px solid ${isDraggingThis?accent+"66":isDragTarget?accent+"44":D.border}`,
                    cursor:"grab",userSelect:"none",
                    transform:isDraggingThis?"scale(1.02)":"scale(1)",
                    opacity:isDraggingThis?0.7:1,
                    transition:"transform .1s,opacity .1s,border-color .15s,background .15s",
                    boxShadow:isDraggingThis?`0 8px 24px rgba(0,0,0,.4)`:isDragTarget?`0 0 0 2px ${accent}33`:"none",
                  }}>
                  <span style={{color:D.textMuted,fontSize:"14px",lineHeight:1,cursor:"grab",flexShrink:0}}>⠿</span>
                  <div style={{width:"20px",height:"20px",borderRadius:"50%",flexShrink:0,
                    background:i<2?`${D.emerald}18`:i>=8?`${D.orange}18`:`${accent}10`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontFamily:D.mono,fontSize:"10px",color:i<2?D.emerald:i>=8?D.orange:D.textMuted}}>
                    {i+1}
                  </div>
                  <span style={{flex:1,fontFamily:D.body,fontSize:"12px",fontWeight:i<2?600:400,color:D.textPrimary}}>{name}</span>
                  <Badge color={rc} sx={{fontSize:"8px"}}>{ri?.role||"—"}</Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SETUP SCREEN
═══════════════════════════════════════════════════════ */
function SetupScreen({onStart}){
  const[step,setStep]=useState(0);
  const[team1Key,setTeam1Key]=useState("");
  const[team2Key,setTeam2Key]=useState("");
  const[overs,setOvers]=useState(20);
  const[xi1,setXi1]=useState([]);const[order1,setOrder1]=useState([]);const[twelfth1,setTwelfth1]=useState(null);
  const[xi2,setXi2]=useState([]);const[order2,setOrder2]=useState([]);const[twelfth2,setTwelfth2]=useState(null);
  const[toss,setToss]=useState(0);const[bat,setBat]=useState(0);
  const[openBowler,setOpenBowler]=useState("");
  const teams=[team1Key||"Team 1",team2Key||"Team 2"];
  const canContinue0=team1Key&&team2Key&&team1Key!==team2Key;
  const canContinue1=xi1.length===11;
  const canContinue2=xi2.length===11;
  const canStart=toss!==undefined&&bat!==undefined;
  const STEPS=["Match","Team 1","Team 2","Toss","Opening"];
  return (
    <div style={{minHeight:"100vh",background:D.base,display:"flex",flexDirection:"column",alignItems:"center",
      justifyContent:"flex-start",padding:"16px",paddingTop:"40px",overflowY:"auto"}}>
      <GS/>
      <div style={{textAlign:"center",marginBottom:"28px"}}>
        <div style={{fontFamily:D.head,fontSize:"clamp(36px,7vw,60px)",fontWeight:800,letterSpacing:"0.04em",
          background:D.grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          backgroundClip:"text",lineHeight:.95,marginBottom:"8px"}}>SCRBRD</div>
        <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:400,color:D.textMuted,
          letterSpacing:"0.2em",textTransform:"uppercase"}}>Cricket Match Centre</div>
        <div style={{width:"60px",height:"2px",background:D.grad,borderRadius:"2px",margin:"12px auto 0"}}/>
      </div>
      {/* Steps */}
      <div style={{display:"flex",gap:"6px",marginBottom:"20px",flexWrap:"wrap",justifyContent:"center"}}>
        {STEPS.map((s,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:"6px"}}>
            <div style={{
              width:"22px",height:"22px",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
              fontFamily:D.mono,fontSize:"10px",fontWeight:600,cursor:i<step?"pointer":"default",
              background:i===step?D.grad:i<step?`${D.emerald}22`:D.surf2,
              color:i===step?"#fff":i<step?D.emerald:D.textMuted,
              border:`1px solid ${i===step?D.indigo+"66":i<step?D.emerald+"44":D.border}`,
              transition:"all .3s",
            }} onClick={()=>i<step&&setStep(i)}>{i<step?"✓":i+1}</div>
            <span style={{fontFamily:D.body,fontSize:"11px",color:i===step?D.textPrimary:D.textMuted,fontWeight:i===step?600:400}}>{s}</span>
            {i<3&&<div style={{width:"16px",height:"1px",background:D.border}}/>}
          </div>
        ))}
      </div>
      <div style={{width:"100%",maxWidth:"520px"}}>
        <Glass style={{padding:"24px 22px"}}>
          {step===0&&(
            <div style={{display:"flex",flexDirection:"column",gap:"18px"}}>
              <TeamSelector value={team1Key} onChange={setTeam1Key} accent={D.sky} label="Team 1"/>
              <TeamSelector value={team2Key} onChange={v=>{if(v!==team1Key)setTeam2Key(v);}} accent={D.emerald} label="Team 2"/>
              {team1Key&&team2Key&&team1Key===team2Key&&(
                <div style={{color:D.rose,fontSize:"11px",fontFamily:D.body,textAlign:"center"}}>Teams must be different</div>
              )}
              <div>
                <Lbl sx={{marginBottom:"8px"}}>Overs Per Innings</Lbl>
                <div style={{display:"flex",gap:"6px"}}>
                  {[10,20,40,50].map(o=>(
                    <button key={o} onClick={()=>setOvers(o)} className="pressBtn" style={{
                      flex:1,padding:"11px 0",borderRadius:D.md,cursor:"pointer",
                      fontFamily:D.mono,fontSize:"15px",fontWeight:500,
                      border:`1px solid ${overs===o?D.indigo+"77":D.border}`,
                      background:overs===o?`${D.indigo}1a`:D.surf2,
                      color:overs===o?D.sky:D.textMuted,transition:"all .2s",
                    }}>{o}</button>
                  ))}
                </div>
              </div>
              <Btn variant="primary" size="lg" full disabled={!canContinue0}
                onClick={()=>canContinue0&&setStep(1)} sx={{borderRadius:D.md}}>
                Select {INT_TEAMS[team1Key]?.flag} {team1Key||"Team 1"} XI →
              </Btn>
            </div>
          )}
          {step===1&&(
            <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                <span style={{fontSize:"22px"}}>{INT_TEAMS[team1Key]?.flag}</span>
                <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary}}>{team1Key}</div>
                <Badge color={D.sky}>XI + 12th</Badge>
              </div>
              <SquadBuilder
                teamKey={team1Key}
                selected11={xi1} setSelected11={setXi1}
                twelfthMan={twelfth1} setTwelfthMan={setTwelfth1}
                battingOrder={order1} setBattingOrder={setOrder1}/>
              <Btn variant="primary" size="lg" full disabled={!canContinue1}
                onClick={()=>canContinue1&&setStep(2)} sx={{borderRadius:D.md}}>
                {canContinue1?"Select "+INT_TEAMS[team2Key]?.flag+" "+team2Key+" XI →":"Select 11 players first"}
              </Btn>
            </div>
          )}
          {step===2&&(
            <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                <span style={{fontSize:"22px"}}>{INT_TEAMS[team2Key]?.flag}</span>
                <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary}}>{team2Key}</div>
                <Badge color={D.emerald}>XI + 12th</Badge>
              </div>
              <SquadBuilder
                teamKey={team2Key}
                selected11={xi2} setSelected11={setXi2}
                twelfthMan={twelfth2} setTwelfthMan={setTwelfth2}
                battingOrder={order2} setBattingOrder={setOrder2}/>
              <Btn variant="primary" size="lg" full disabled={!canContinue2}
                onClick={()=>canContinue2&&setStep(3)} sx={{borderRadius:D.md}}>
                {canContinue2?"Proceed to Toss →":"Select 11 players first"}
              </Btn>
            </div>
          )}
          {step===3&&(
            <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
              {/* Match summary */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.lg,padding:"14px 16px"}}>
                <div style={{textAlign:"center",flex:1}}>
                  <div style={{fontSize:"24px",marginBottom:"4px"}}>{INT_TEAMS[team1Key]?.flag}</div>
                  <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary}}>{team1Key}</div>
                  <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{INT_TEAMS[team1Key]?.abbr}</div>
                </div>
                <div style={{textAlign:"center",padding:"0 16px"}}>
                  <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textMuted,letterSpacing:"0.1em"}}>vs</div>
                  <div style={{fontFamily:D.mono,fontSize:"11px",color:D.amber,marginTop:"4px"}}>{overs} ov</div>
                </div>
                <div style={{textAlign:"center",flex:1}}>
                  <div style={{fontSize:"24px",marginBottom:"4px"}}>{INT_TEAMS[team2Key]?.flag}</div>
                  <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary}}>{team2Key}</div>
                  <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{INT_TEAMS[team2Key]?.abbr}</div>
                </div>
              </div>
              <div>
                <Lbl sx={{marginBottom:"8px"}}>Toss Won By</Lbl>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                  {[[team1Key,INT_TEAMS[team1Key]?.flag],[team2Key,INT_TEAMS[team2Key]?.flag]].map(([t,flag],i)=>(
                    <button key={i} onClick={()=>setToss(i)} className="pressBtn" style={{
                      padding:"12px",borderRadius:D.md,cursor:"pointer",
                      fontFamily:D.body,fontSize:"13px",fontWeight:600,
                      border:`1px solid ${toss===i?D.emerald+"66":D.border}`,
                      background:toss===i?`${D.emerald}14`:D.surf2,
                      color:toss===i?D.emerald:D.textSecondary,transition:"all .2s",
                    }}>{flag} {t}</button>
                  ))}
                </div>
              </div>
              <div>
                <Lbl sx={{marginBottom:"8px"}}>{[team1Key,team2Key][toss]} elected to…</Lbl>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                  {["Bat","Bowl"].map((opt,i)=>(
                    <button key={i} onClick={()=>setBat(i)} className="pressBtn" style={{
                      padding:"12px",borderRadius:D.md,cursor:"pointer",
                      fontFamily:D.body,fontSize:"13px",fontWeight:600,
                      border:`1px solid ${bat===i?D.amber+"66":D.border}`,
                      background:bat===i?`${D.amber}14`:D.surf2,
                      color:bat===i?D.amber:D.textSecondary,transition:"all .2s",
                    }}>{opt}</button>
                  ))}
                </div>
              </div>
              <Btn variant="primary" size="lg" full onClick={()=>setStep(4)} sx={{borderRadius:D.md}}>
                Confirm Toss →
              </Btn>
            </div>
          )}
          {step===4&&(()=>{
            // Determine batting & bowling teams
            const first=bat===0?toss:1-toss;
            const batKey=first===0?team1Key:team2Key;
            const bowlKey=first===0?team2Key:team1Key;
            const batOrder=first===0?order1:order2;
            const setBatOrder=first===0?setOrder1:setOrder2;
            const bowlingSquad=INT_TEAMS[bowlKey]?.players.map(p=>p.name)||[];
            return (
              <OpeningSetupStep
                batKey={batKey} bowlKey={bowlKey}
                batOrder={batOrder} setBatOrder={setBatOrder}
                bowlingSquad={bowlingSquad} bowlingTeamKey={bowlKey}
                onConfirm={(opener1,opener2,openBowler)=>{
                  const sq1=first===0?order1:order2;
                  const sq2=first===0?order2:order1;
                  onStart({
                    team1:team1Key, team2:team2Key, overs, toss, bat,
                    squad1:sq1, squad2:sq2,
                    twelfth1:first===0?twelfth1:twelfth2,
                    twelfth2:first===0?twelfth2:twelfth1,
                    teamKey1:first===0?team1Key:team2Key,
                    teamKey2:first===0?team2Key:team1Key,
                    opener1, opener2, openBowler,
                  });
                }}/>
            );
          })()}
        </Glass>
      </div>
    </div>
  );
}

export { OpeningSetupStep, SetupScreen, SquadBuilder, TeamSelector };
