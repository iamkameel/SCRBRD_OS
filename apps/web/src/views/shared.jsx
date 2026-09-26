import { ROLES } from "../design/roles.js";
import { D, T, textOn } from "../design/tokens.js";
import { mulberry32, strSeed } from "../lib/rng.js";
import { can } from "../rbac/index.js";
import { Modal, Pill } from "../ui/primitives.jsx";
import { teamCodeIn } from "@scrbrd/policy/teams";
import { Icon, isIcon } from "../ui/icons.jsx";

// ══════════════════════════════════════════════════════
//  MATCH CENTRE VIEW

// ══════════════════════════════════════════════════════
//  WEATHER CHIP — reusable
// ══════════════════════════════════════════════════════
function WeatherChip({ w, compact }) {
  if (!w) return null;
  // `w.icon` is a name from ui/icons.jsx; anything else falls back to the
  // neutral sky rather than printing itself.
  const sky = isIcon(w.icon) ? w.icon : "cloud-sun";
  const bc = w.playable ? D.emerald : D.rose;
  if (compact) return (
    <div style={{display:"flex",alignItems:"center",gap:"5px",padding:"3px 8px",borderRadius:D.pill,
      background:bc+"14",border:`1px solid ${bc}28`}}>
      <span style={{fontSize:"13px",color:bc}}><Icon name={sky}/></span>
      <span style={{fontFamily:D.mono,fontSize:"12px",color:textOn(bc),fontWeight:600}}>{w.tempC}°C</span>
      <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>{w.condition}</span>
      {!w.playable && <span style={{fontFamily:D.body,fontSize:"12px",color:D.roseText,fontWeight:700}}><Icon name="triangle-alert"/> Not playable</span>}
    </div>
  );
  return (
    <div style={{background:D.surf2,borderRadius:D.lg,padding:"14px 16px",border:`1px solid ${bc}22`}}>
      <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"10px"}}>
        <span style={{fontSize:"32px",color:D.textSecondary}}><Icon name={sky}/></span>
        <div>
          <div style={{fontFamily:D.head,fontSize:"20px",fontWeight:800,color:D.textPrimary}}>{w.tempC}°C</div>
          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>{w.condition}</div>
        </div>
        <div style={{marginLeft:"auto",padding:"5px 12px",borderRadius:D.pill,background:bc+"18",border:`1px solid ${bc}30`}}>
          <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:700,color:textOn(bc)}}>{w.playable?<><Icon name="circle-check"/> Playable</>:<><Icon name="triangle-alert"/> Not playable</>}</span>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"var(--g-4,repeat(4,1fr))",gap:"8px",marginBottom:"10px"}}>
        {[["droplet","Humidity",`${w.humidity}%`],["wind","Wind",`${w.windKph} km/h ${w.windDir}`],["umbrella","Rain",`${w.rainChancePct}%`],["sun","UV",`${w.uvIndex}/11`]].map(([ic,l,v])=>(
          <div key={l} style={{textAlign:"center",padding:"7px 4px",background:D.surf3,borderRadius:D.sm}}>
            <div style={{fontFamily:D.mono,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{v}</div>
            <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginTop:"2px"}}><Icon name={ic}/> {l}</div>
          </div>
        ))}
      </div>
      <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,background:D.surf3,padding:"8px 10px",borderRadius:D.sm,fontStyle:"italic"}}>
        <Icon name="clipboard-list"/> {w.forecast}
      </div>
    </div>
  );
}

const OPP_POOL = ["T van Rooyen","K Naidoo","M Botha","S Mkhize","J Pretorius","L Govender","D Erasmus","A Zondi","R Pillay","W du Toit","N Cele","B Steyn","C Moodley","P Ngcobo","G Venter","F Hadebe","H Marais","U Dube"];

// Takes the roster it may use, rather than going and getting one.
//
// It used to call scoped() itself, which meant a module-scope helper reached
// into the data layer and decided what a caller could see. That was already
// the wrong shape, and once the server became authoritative it stopped working
// at all: in a live session the client-side scoping layer refuses, so this
// silently produced a fully synthetic XI on a screen that looked real.
//
// Passing `players` in makes the caller responsible for having authorised
// them — which the caller can, because it is a component and can read through
// the hooks. An empty list still fails closed to a synthetic squad.
function teamSquad(teamName, players = []){
  const token = teamCodeIn(teamName);
  const isHilton = /Hilton/i.test(teamName);
  const own = (isHilton && token)
    ? players.filter(p=>p.team===token).map(p=>p.name)
    : [];
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
// Same change as teamSquad, for the same reason: the assessment matrix is
// passed in by a caller that has already read it under this principal, instead
// of being fetched from a helper nobody authorised. An empty matrix falls
// through to the derived demo profile, which is explicitly marked
// `assessed:false` so a screen never presents a synthesised number as a
// coach's judgement.
function skillsFor(p, matrix = {}){
  if(matrix[p.id]) return { data:matrix[p.id], assessed:true };
  // Deterministic demo derivation from season stats until a real assessment exists
  const rng=(()=>{let s=strSeed(p.id);return()=>{s|=0;s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};})();
  // 1-20, clamped inside the scale. Never 0 and never 20: a synthesised number
  // must not be able to claim either end of a scale whose ends are defined by
  // a coach's written anchors.
  const j=(base)=>Math.max(4,Math.min(18,Math.round(base+rng()*3-1.5)));
  const batBase=Math.min(17,7+(p.avg||20)*0.18), bowlBase=p.wkts>5?14:8;
  return { assessed:false, data:{
    technical:{footwork:j(batBase),timing:j(batBase),power:j(batBase-1),shotRange:j(batBase-1),
               defence:j(batBase),againstPace:j(batBase-1),againstSpin:j(batBase-1),
               lineAndLength:j(bowlBase),seamAndSwing:j(bowlBase),spin:j(bowlBase-2),
               variations:j(bowlBase-1),catching:j(13),groundFielding:j(12),throwing:j(13),glovework:j(9)},
    mental:{concentration:j(13),composure:j(13),decisions:j(12),anticipation:j(12),determination:j(13),
            bravery:j(12),leadership:j(11),teamwork:j(13),workRate:j(13),gameAwareness:j(12)},
    physical:{pace:j(13),acceleration:j(13),agility:j(13),balance:j(13),stamina:j(12),
              strength:j(11),naturalFitness:j(13),bowlingPace:j(bowlBase)},
  }};
}

function PlayerProfileModal({ player, role, skills = {}, onClose, onFullProfile }){
  if(!player) return null;
  const stripped = can(role,"players","r").deny.length>0;
  const sk = skillsFor(player, skills);
  const canFull = ROLES[role]?.nav.includes("profiles");
  const Stat = ({l,v,c}) => (
    <div style={{flex:1,minWidth:"70px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,padding:"8px 6px",textAlign:"center"}}>
      <div style={{fontFamily:D.mono,fontSize:"15px",fontWeight:700,color:c||D.textPrimary}}>{v??"–"}</div>
      <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginTop:"2px"}}>{l}</div>
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
        <div style={{width:"52px",height:"52px",borderRadius:"50%",background:D.gradMain,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:D.head,fontSize:"17px",fontWeight:800,color:T.light.ink,flexShrink:0}}>
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
      {stripped&&<div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"12px"}}><Icon name="lock"/> Some personal details are hidden for your role.</div>}
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

export { OPP_POOL, PlayerProfileModal, WeatherChip, fmtOvOS, parseBalls, parseScore, skillsFor, teamSquad };
