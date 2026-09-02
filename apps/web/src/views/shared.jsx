import { useState, useMemo } from "react";
import { COMPETITIONS, PLAYERS, SKILLS_MATRIX, STAFF } from "../data/mock.js";
import { ROLES } from "../design/roles.js";
import { D } from "../design/tokens.js";
import { mulberry32, strSeed } from "../lib/rng.js";
import { can, filterRecord } from "../rbac/index.js";
import { BatsmanChart, BowlerChart, ManhattanChart, WormChart } from "../scorer/charts.jsx";
import { seedCompletedMatch } from "../scorer/seed.js";
import { Badge, Modal, Pill, SkillBar } from "../ui/primitives.jsx";

// ══════════════════════════════════════════════════════
//  MATCH CENTRE VIEW

// ══════════════════════════════════════════════════════
//  WEATHER CHIP — reusable
// ══════════════════════════════════════════════════════
function WeatherChip({ w, compact }) {
  if (!w) return null;
  const bc = w.playable ? D.emerald : D.rose;
  if (compact) return (
    <div style={{display:"flex",alignItems:"center",gap:"5px",padding:"3px 8px",borderRadius:D.pill,
      background:bc+"14",border:`1px solid ${bc}28`}}>
      <span style={{fontSize:"13px"}}>{w.icon}</span>
      <span style={{fontFamily:D.mono,fontSize:"10px",color:bc,fontWeight:600}}>{w.tempC}°C</span>
      <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{w.condition}</span>
      {!w.playable && <span style={{fontFamily:D.head,fontSize:"9px",color:D.rose,fontWeight:700,letterSpacing:"0.05em"}}>⚠ NOT PLAYABLE</span>}
    </div>
  );
  return (
    <div style={{background:D.surf2,borderRadius:D.lg,padding:"14px 16px",border:`1px solid ${bc}22`}}>
      <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"10px"}}>
        <span style={{fontSize:"32px"}}>{w.icon}</span>
        <div>
          <div style={{fontFamily:D.head,fontSize:"20px",fontWeight:800,color:D.textPrimary}}>{w.tempC}°C</div>
          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>{w.condition}</div>
        </div>
        <div style={{marginLeft:"auto",padding:"5px 12px",borderRadius:D.pill,background:bc+"18",border:`1px solid ${bc}30`}}>
          <span style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:bc}}>{w.playable?"✓ PLAYABLE":"⚠ NOT PLAYABLE"}</span>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"var(--g-4,repeat(4,1fr))",gap:"8px",marginBottom:"10px"}}>
        {[["💧 Humidity",`${w.humidity}%`],["💨 Wind",`${w.windKph} km/h ${w.windDir}`],[`☂ Rain`,`${w.rainChancePct}%`],["☀️ UV",`${w.uvIndex}/11`]].map(([l,v])=>(
          <div key={l} style={{textAlign:"center",padding:"7px 4px",background:D.surf3,borderRadius:D.sm}}>
            <div style={{fontFamily:D.mono,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{v}</div>
            <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted,marginTop:"2px"}}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,background:D.surf3,padding:"8px 10px",borderRadius:D.sm,fontStyle:"italic"}}>
        📋 {w.forecast}
      </div>
    </div>
  );
}

const OPP_POOL = ["T van Rooyen","K Naidoo","M Botha","S Mkhize","J Pretorius","L Govender","D Erasmus","A Zondi","R Pillay","W du Toit","N Cele","B Steyn","C Moodley","P Ngcobo","G Venter","F Hadebe","H Marais","U Dube"];

function teamSquad(teamName){
  const token = (teamName.match(/U\d{2}[A-Z]?/)||[])[0];
  const isHilton = /Hilton/i.test(teamName);
  const own = isHilton && token ? PLAYERS.filter(p=>p.team===token).map(p=>p.name) : [];
  const rng = mulberry32(strSeed(teamName));
  const pool = [...OPP_POOL].sort(()=>rng()-0.5);
  const out = [...own];
  while(out.length<11) out.push(pool[out.length % pool.length]+(own.length?"":""));
  return out.slice(0,11);
}

const parseScore = s => { const [r,w] = String(s).split("/").map(Number); return { runs:r, wkts:isNaN(w)?10:w }; };

const parseBalls = ov => { const [o,b] = String(ov).split(".").map(Number); return o*6 + (b||0); };

const fmtOvOS = b => `${Math.floor(b/6)}${b%6?"."+(b%6):""}`;

// ══════════════════════════════════════════════════════
//  PLAYER PROFILE POPOVER — opened from any player name.
//  Receives an RBAC-filtered record: stripped fields arrive
//  null and are simply not rendered.
// ══════════════════════════════════════════════════════
function skillsFor(p){
  if(SKILLS_MATRIX[p.id]) return { data:SKILLS_MATRIX[p.id], assessed:true };
  // Deterministic demo derivation from season stats until a real assessment exists
  const rng=(()=>{let s=strSeed(p.id);return()=>{s|=0;s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};})();
  const j=(base)=>Math.max(30,Math.min(92,Math.round(base+rng()*14-7)));
  const batBase=Math.min(88,35+(p.avg||20)*0.9), bowlBase=p.wkts>5?70:40;
  return { assessed:false, data:{
    batting:{technique:j(batBase),power:j(batBase-4),footwork:j(batBase-2),running:j(batBase),temperament:j(batBase+2)},
    bowling:{accuracy:j(bowlBase),line:j(bowlBase),variations:j(bowlBase-6),pace:j(bowlBase),stamina:j(bowlBase+2)},
    fielding:{catching:j(66),groundwork:j(64),throwing:j(65),positioning:j(66)},
    fitness:{speed:j(70),agility:j(70),endurance:j(68),strength:j(66)},
  }};
}

function PlayerProfileModal({ player, role, onClose, onFullProfile }){
  if(!player) return null;
  const stripped = can(role,"players","r").deny.length>0;
  const sk = skillsFor(player);
  const canFull = ROLES[role]?.nav.includes("profiles");
  const Stat = ({l,v,c}) => (
    <div style={{flex:1,minWidth:"70px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,padding:"8px 6px",textAlign:"center"}}>
      <div style={{fontFamily:D.mono,fontSize:"15px",fontWeight:700,color:c||D.textPrimary}}>{v??"–"}</div>
      <div style={{fontFamily:D.head,fontSize:"7px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginTop:"2px"}}>{l}</div>
    </div>
  );
  const SkillBar = ({l,v}) => (
    <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"5px"}}>
      <span style={{fontFamily:D.body,fontSize:"10px",color:D.textSecondary,width:"84px",textTransform:"capitalize"}}>{l}</span>
      <div style={{flex:1,height:"5px",borderRadius:D.pill,background:D.surf3,overflow:"hidden"}}>
        <div style={{width:`${v}%`,height:"100%",borderRadius:D.pill,background:v>=75?D.emerald:v>=55?D.indigo:D.amber}}/>
      </div>
      <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,width:"22px",textAlign:"right"}}>{v}</span>
    </div>
  );
  const vitals = [
    player.born&&["Born",player.born], player.hometown&&["Hometown",player.hometown],
    player.houseAtSchool&&["House",player.houseAtSchool], player.height&&["Height",player.height],
    player.weight&&["Weight",player.weight],
    player.batHand&&["Bats",player.batHand==="R"?"Right-hand":"Left-hand"],
    player.bowlArm&&["Bowls",`${player.bowlArm==="R"?"Right":"Left"}-arm ${player.bowlStyle==="F"?"fast":player.bowlStyle==="M"?"medium":"spin"}`],
  ].filter(Boolean);
  const ct = player.careerTotals;
  return (
    <Modal title="Player Profile" onClose={onClose} width="560px">
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"12px"}}>
        <div style={{width:"52px",height:"52px",borderRadius:"50%",background:D.gradMain,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:D.head,fontSize:"17px",fontWeight:800,color:"#fff",flexShrink:0}}>
          {player.name.split(" ").map(w=>w[0]).slice(0,2).join("")}
        </div>
        <div style={{minWidth:0}}>
          <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:800,color:D.textPrimary}}>
            {player.name}{player.cap==="c"&&<span style={{marginLeft:"6px",fontFamily:D.mono,fontSize:"10px",color:D.amber}}>©</span>}
          </div>
          <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginTop:"4px"}}>
            <Pill color={D.indigo}>{player.team}</Pill>
            <Pill color={D.violet}>{player.role}</Pill>
            {player.age&&<Pill color={D.textMuted}>{player.age} yrs</Pill>}
            {player.fitness&&<Pill color={player.fitness==="fit"?D.emerald:D.rose}>{player.fitness}</Pill>}
          </div>
        </div>
      </div>
      {/* Bio */}
      {player.bio&&<div style={{fontFamily:D.body,fontSize:"12px",lineHeight:1.6,color:D.textSecondary,marginBottom:"12px"}}>{player.bio}</div>}
      {/* Vitals — RBAC-stripped fields simply don't render */}
      {vitals.length>0&&(
        <div style={{display:"flex",gap:"10px",flexWrap:"wrap",marginBottom:"12px"}}>
          {vitals.map(([l,v])=>(
            <div key={l}><span style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted}}>{l} </span>
            <span style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary}}>{v}</span></div>
          ))}
        </div>
      )}
      {stripped&&<div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"12px"}}>🔒 Some personal details are hidden for your role.</div>}
      {/* Season + career stats */}
      <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"12px"}}>
        <Stat l="Avg" v={player.avg} c={D.emerald}/>
        <Stat l="SR" v={player.sr} c={D.indigo}/>
        <Stat l="Wkts" v={player.wkts} c={D.rose}/>
        <Stat l="Econ" v={player.econ} c={D.amber}/>
        {ct&&<Stat l="Runs" v={ct.runs}/>}
        {ct&&<Stat l="HS" v={ct.hs}/>}
        {ct&&<Stat l="50s/100s" v={`${ct.fifties}/${ct.hundreds}`}/>}
      </div>
      {/* Recent form */}
      {player.seasonForm&&player.seasonForm.length>0&&(
        <>
          <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginBottom:"6px"}}>Recent form</div>
          <div style={{border:`1px solid ${D.border}`,borderRadius:D.lg,overflow:"hidden",marginBottom:"12px"}}>
            {player.seasonForm.slice(-5).reverse().map((f,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 12px",borderTop:i?`1px solid ${D.border}`:"none"}}>
                <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>vs {f.opp}</span>
                <span style={{display:"flex",gap:"10px",alignItems:"center"}}>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textPrimary}}>{f.runs} runs{f.wkts?` · ${f.wkts}w`:""}</span>
                  <span style={{fontFamily:D.head,fontSize:"9px",fontWeight:800,color:f.result==="W"?D.emerald:D.rose}}>{f.result}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {/* Attributes */}
      <div style={{display:"flex",alignItems:"baseline",gap:"8px",marginBottom:"6px"}}>
        <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted}}>Attributes</div>
        {!sk.assessed&&<span style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>estimated — no coach assessment yet</span>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px",marginBottom:"14px"}}>
        {Object.entries(sk.data).map(([grp,vals])=>(
          <div key={grp} style={{background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.lg,padding:"10px 12px"}}>
            <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:D.textSecondary,marginBottom:"7px"}}>{grp}</div>
            {Object.entries(vals).map(([k,v])=><SkillBar key={k} l={k} v={v}/>)}
          </div>
        ))}
      </div>
      {canFull&&onFullProfile&&(
        <button onClick={()=>onFullProfile(player.id)} className="pressBtn" style={{width:"100%",padding:"11px",borderRadius:D.lg,cursor:"pointer",
          background:D.indigo+"18",border:`1px solid ${D.indigo}44`,color:D.textPrimary,fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.08em"}}>
          OPEN FULL PROFILE →
        </button>
      )}
    </Modal>
  );
}

function ScorecardModal({ match, onClose, role, onNavProfile }){
  const [tab, setTab] = useState(0);
  const [prof, setProf] = useState(null);
  // Name → RBAC-gated profile opener. Opponent (synthetic) names have no
  // profile; roles without players-resource access get no links at all.
  const linkFor = name => {
    if(!can(role,"players","r").allowed) return null;
    const p = PLAYERS.find(x=>x.name===name);
    return p ? ()=>setProf(filterRecord(role,"players",p)) : null;
  };
  const { WormChart, ManhattanChart, BatsmanChart, BowlerChart } = ScorerApp.charts;
  const isLive = match.status!=="complete";
  const seeded = useMemo(()=>{
    const inns=[];
    if(match.scorecard?.home) inns.push({...parseScore(match.scorecard.home.score), balls:parseBalls(match.scorecard.home.overs)});
    if(match.scorecard?.away) inns.push({...parseScore(match.scorecard.away.score), balls:parseBalls(match.scorecard.away.overs)});
    return ScorerApp.seedCompletedMatch({
      matchId: match.id, team1: match.homeTeam, team2: match.awayTeam,
      squad1: teamSquad(match.homeTeam), squad2: teamSquad(match.awayTeam),
      inns: inns.map(x=>({ runs:x.runs, wickets:x.wkts, balls:x.balls })),
      liveLast: isLive,
    });
  },[match.id,isLive]);
  const inn = seeded.innings[tab];
  const comp = COMPETITIONS.find(c=>c.id===match.competition);
  const scorerStaff = STAFF.find(s=>s.id===match.scorerId);
  const extrasSum = i => Object.values(i.extras).reduce((a,b)=>a+b,0);
  const legal = i => i.ballLog.filter(b=>b.type!=="Wd"&&b.type!=="Nb");
  const topBat = i => [...i.batsmen].sort((a,b)=>b.runs-a.runs)[0];
  const topBowl = i => [...i.bowlers].sort((a,b)=>b.wickets-a.wickets||a.runs-b.runs)[0];
  const Row = ({cells, head, hi, onName}) => (
    <div style={{display:"grid",gridTemplateColumns:"minmax(0,2.4fr) 44px 40px 34px 34px 52px",gap:"6px",padding:head?"8px 12px":"9px 12px",
      borderTop:head?"none":`1px solid ${D.border}`,background:head?D.surf2:hi?D.indigo+"0a":"transparent",alignItems:"center"}}>
      {cells.map((c,i)=>(
        <div key={i} style={{fontFamily:i===0?D.body:D.mono,fontSize:head?"9px":i===0?"12px":"11px",
          fontWeight:head?700:i===0?500:400,letterSpacing:head?"0.08em":0,textTransform:head?"uppercase":"none",
          color:head?D.textMuted:i===0?D.textPrimary:D.textSecondary,textAlign:i===0?"left":"right",
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:i===0?"normal":"nowrap"}}>
          {i===0&&onName
            ? <button onClick={onName} className="pressBtn" style={{background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.sky,textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:"3px",textAlign:"left"}}>{c}</button>
            : c}
        </div>
      ))}
    </div>
  );
  const Kpi = ({l,v,c}) => (
    <div style={{flex:1,minWidth:"86px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,padding:"8px 10px",textAlign:"center"}}>
      <div style={{fontFamily:D.mono,fontSize:"15px",fontWeight:700,color:c||D.textPrimary}}>{v}</div>
      <div style={{fontFamily:D.head,fontSize:"7px",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:D.textMuted,marginTop:"2px"}}>{l}</div>
    </div>
  );
  const SecLbl = ({children}) => (
    <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,margin:"14px 0 6px"}}>{children}</div>
  );
  if(!inn) return null;
  const lb = legal(inn);
  const dots = lb.filter(b=>b.type==="run"&&b.value===0).length;
  const bnds = lb.filter(b=>b.value===4||b.value===6).length;
  const tb = topBat(inn), tw = topBowl(inn);
  return (
    <Modal title={isLive?"Live Scorecard & Analysis":"Match Scorecard & Analysis"} onClose={onClose} width="720px">
      {/* Result banner */}
      <div style={{textAlign:"center",marginBottom:"12px"}}>
        <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:800,color:D.textPrimary}}>{match.homeTeam} <span style={{color:D.textMuted,fontSize:"11px"}}>vs</span> {match.awayTeam}</div>
        <div style={{display:"flex",justifyContent:"center",gap:"18px",marginTop:"6px",fontFamily:D.mono,fontSize:"16px",color:D.textPrimary}}>
          {match.scorecard?.home&&<span>{match.scorecard.home.score} <span style={{fontSize:"11px",color:D.textMuted}}>({match.scorecard.home.overs})</span></span>}
          {match.scorecard?.away&&<span>{match.scorecard.away.score} <span style={{fontSize:"11px",color:D.textMuted}}>({match.scorecard.away.overs})</span></span>}
        </div>
        {isLive
          ? <div style={{display:"flex",gap:"6px",justifyContent:"center",alignItems:"center",flexWrap:"wrap",marginTop:"4px"}}>
              <span style={{display:"flex",alignItems:"center",gap:"5px",padding:"3px 10px",borderRadius:D.pill,background:D.emerald+"18",border:`1px solid ${D.emerald}33`,fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",color:D.emerald}}>
                <div className="live-dot"/>IN PROGRESS
              </span>
              {match.result&&<span style={{padding:"3px 10px",borderRadius:D.pill,background:D.sky+"14",border:`1px solid ${D.sky}30`,fontFamily:D.body,fontSize:"11px",color:D.sky}}>⛈ {match.result}</span>}
            </div>
          : match.result&&<Badge color={D.amber}>{match.result}</Badge>}
      </div>
      <div style={{display:"flex",gap:"6px",flexWrap:"wrap",justifyContent:"center",marginBottom:"12px"}}>
        {comp&&<Pill color={D.violet}>🏆 {comp.name}</Pill>}
        <Pill color={D.sky}>📍 {match.venue}</Pill>
        <Pill color={D.textMuted}>📅 {match.date}</Pill>
        {scorerStaff&&<Pill color={D.orange}>📋 {scorerStaff.name}</Pill>}
      </div>
      {/* Match worm — both innings */}
      {seeded.innings.length>1&&(
        <>
          <SecLbl>Match worm</SecLbl>
          <WormChart innings={seeded.innings} curIn={seeded.innings.length-1} match={seeded.cfg}/>
        </>
      )}
      {/* Innings tabs */}
      <div style={{display:"flex",gap:"6px",margin:"14px 0 10px"}}>
        {seeded.innings.map((x,i)=>(
          <button key={i} onClick={()=>setTab(i)} className="pressBtn" style={{flex:1,padding:"7px 10px",borderRadius:D.md,cursor:"pointer",
            background:tab===i?D.indigo+"18":D.surf2,border:`1px solid ${tab===i?D.indigo+"44":D.border}`,
            fontFamily:D.head,fontSize:"10px",fontWeight:700,color:tab===i?D.textPrimary:D.textMuted}}>
            {i+1}ST INN · {x.battingTeam}{!x.complete&&<span style={{color:D.emerald}}> · LIVE</span>}
          </button>
        ))}
      </div>
      {/* Innings analysis KPIs */}
      <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"10px"}}>
        <Kpi l="Run rate" v={((inn.runs/Math.max(1,inn.balls))*6).toFixed(2)} c={D.emerald}/>
        <Kpi l="Dot %" v={`${Math.round(dots/Math.max(1,lb.length)*100)}%`}/>
        <Kpi l="Boundaries" v={bnds} c={D.indigo}/>
        <Kpi l="Top bat" v={tb?`${tb.runs}`:"–"} c={D.amber}/>
        <Kpi l="Best bowl" v={tw?`${tw.wickets}/${tw.runs}`:"–"} c={D.rose}/>
      </div>
      {/* Per-innings charts from the scorer engine */}
      <SecLbl>Runs per over</SecLbl>
      <ManhattanChart inn={inn} match={seeded.cfg}/>
      <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"10px",marginTop:"10px"}}>
        <div><SecLbl>Batting impact</SecLbl><BatsmanChart inn={inn}/></div>
        <div><SecLbl>Bowling economy</SecLbl><BowlerChart inn={inn}/></div>
      </div>
      {/* Batting card */}
      <SecLbl>Batting</SecLbl>
      <div style={{border:`1px solid ${D.border}`,borderRadius:D.lg,overflow:"hidden",marginBottom:"12px"}}>
        <Row head cells={["Batter","R","B","4s","6s","SR"]}/>
        {inn.batsmen.map((b,i)=>(
          <div key={i}>
            <Row hi={b.runs>=50} onName={linkFor(b.name)} cells={[b.name,b.runs,b.balls,b.fours,b.sixes,b.balls?((b.runs/b.balls)*100).toFixed(1):"–"]}/>
            <div style={{padding:"0 12px 7px",fontFamily:D.body,fontSize:"10px",color:b.status==="out"?D.textMuted:D.emerald,marginTop:"-4px"}}>{b.status==="out"?b.dismissal:"not out"}</div>
          </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",padding:"10px 12px",borderTop:`1px solid ${D.borderMed}`,background:D.surf2}}>
          <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>Extras {extrasSum(inn)} (w {inn.extras.wide})</span>
          <span style={{fontFamily:D.mono,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{inn.runs}/{inn.wickets} <span style={{fontSize:"10px",color:D.textMuted}}>({fmtOvOS(inn.balls)} ov{inn.complete?"":", in progress"})</span></span>
        </div>
      </div>
      {inn.fow.length>0&&(
        <div style={{marginBottom:"12px"}}>
          <SecLbl>Fall of wickets</SecLbl>
          <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textSecondary,lineHeight:1.9}}>
            {inn.fow.map((f,i)=>{
              const lk = linkFor(f.batsman);
              return (
                <span key={i}>{i>0&&"  ·  "}{f.runs}/{f.wickets} (
                  {lk?<button onClick={lk} className="pressBtn" style={{background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:D.mono,fontSize:"11px",color:D.sky,textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:"3px"}}>{f.batsman}</button>:f.batsman}
                , {f.overs})</span>
              );
            })}
          </div>
        </div>
      )}
      {prof&&<PlayerProfileModal player={prof} role={role}
        onClose={()=>setProf(null)}
        onFullProfile={onNavProfile?(id)=>{setProf(null);onNavProfile(id);}:null}/>}
      {/* Bowling card */}
      <SecLbl>Bowling</SecLbl>
      <div style={{border:`1px solid ${D.border}`,borderRadius:D.lg,overflow:"hidden"}}>
        <Row head cells={["Bowler","O","M","R","W","Econ"]}/>
        {inn.bowlers.map((bw,i)=>(
          <Row key={i} hi={bw.wickets>=3} onName={linkFor(bw.name)} cells={[bw.name,fmtOvOS(bw.balls),bw.maidens,bw.runs,bw.wickets,(bw.runs/Math.max(1,bw.balls/6)).toFixed(2)]}/>
        ))}
      </div>
    </Modal>
  );
}

export { OPP_POOL, PlayerProfileModal, ScorecardModal, WeatherChip, fmtOvOS, parseBalls, parseScore, skillsFor, teamSquad };
