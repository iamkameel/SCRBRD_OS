import { useState, useEffect, useRef } from "react";
import { askStatGuru } from "../lib/ai.js";
import { SCHOOLS_REGISTRY } from "../data/institution.js";
import { COACHES, COMPETITIONS, MATCHES, PLAYERS, STAFF } from "../data/mock.js";
import { ROLES } from "../design/roles.js";
import { D } from "../design/tokens.js";

// ══════════════════════════════════════════════════════
//  TOPBAR + GLOBAL SEARCH
// ══════════════════════════════════════════════════════
function GlobalSearch({ onNav, onClose }) {
  const [q, setQ] = useState("");
  const [aiMode, setAiMode] = useState(false);
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(()=>{ inputRef.current?.focus(); },[]);

  const ALL_PLAYERS = PLAYERS;
  const ALL_STAFF   = STAFF.concat(COACHES.map(c=>({...c,role:"coach",name:c.name})));

  const results = q.length < 2 ? [] : [
    ...ALL_PLAYERS.filter(p=>p.name.toLowerCase().includes(q.toLowerCase())).slice(0,4).map(p=>({
      type:"player", icon:ROLES[p.role==="WK"?"player":"player"]?.icon||"🏏",
      label:p.name, sub:`${p.role} · ${p.team} · ${p.school}`,
      action:()=>{ onNav("profiles"); onClose(); },
    })),
    ...ALL_STAFF.filter(s=>s.name.toLowerCase().includes(q.toLowerCase())).slice(0,3).map(s=>({
      type:"staff", icon:"👤",
      label:s.name, sub:`${s.role} · ${s.school||"Hilton College"}`,
      action:()=>{ onNav("staff"); onClose(); },
    })),
    ...MATCHES.filter(m=>(m.home+m.away+m.venue).toLowerCase().includes(q.toLowerCase())).slice(0,3).map(m=>({
      type:"match", icon:"🏏",
      label:`${m.home} vs ${m.away}`, sub:`${m.date} · ${m.format} · ${m.status}`,
      action:()=>{ onNav("matches"); onClose(); },
    })),
    ...COMPETITIONS.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())).slice(0,2).map(c=>({
      type:"competition", icon:"🏆",
      label:c.name, sub:c.format,
      action:()=>{ onNav("competitions"); onClose(); },
    })),
    ...SCHOOLS_REGISTRY.filter(s=>s.name.toLowerCase().includes(q.toLowerCase())).slice(0,2).map(s=>({
      type:"school", icon:"🏫",
      label:s.name, sub:`${s.city} · ${s.province}`,
      action:()=>{ onClose(); },
    })),
  ];

  const statKeywords = ["average","strike rate","wickets","runs","economy","best","career","form","stats","vs","against","how many","who is","top scorer","best bowler"];
  const looksLikeStat = q.length > 8 && statKeywords.some(k=>q.toLowerCase().includes(k));

  const askGuru = async () => {
    if (!q.trim()) return;
    setAiLoading(true); setAiMode(true); setAiAnswer("");
    const playerContext = PLAYERS.map(p=>`${p.name} (${p.role}, ${p.team}, ${p.school})`).join(", ");
    const matchContext = MATCHES.slice(0,5).map(m=>`${m.home} vs ${m.away} ${m.date} ${m.result||m.status}`).join("; ");
    try {
      // Goes to our own service, which holds the credential. The browser has
      // no API key — see apps/web/src/lib/ai.js and services/api/ai/.
      const answer = await askStatGuru(q, `Players: ${playerContext}. Recent matches: ${matchContext}.`);
      setAiAnswer(answer || "No answer available.");
    } catch { setAiAnswer("StatGuru offline — check your connection."); }
    setAiLoading(false);
  };

  const typeColor = t => ({player:D.sky,staff:D.indigo,match:D.emerald,competition:D.amber,school:D.teal})[t]||D.textMuted;

  return (
    <div style={{position:"fixed",inset:0,zIndex:400,background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"80px 16px 0"}}>
      <div style={{width:"100%",maxWidth:"640px",borderRadius:D.xl,border:`1px solid ${D.borderMed}`,background:D.surf1,overflow:"hidden",boxShadow:"0 24px 80px rgba(0,0,0,0.5)"}}>
        {/* Input row */}
        <div style={{display:"flex",alignItems:"center",gap:"10px",padding:"14px 16px",borderBottom:`1px solid ${D.border}`}}>
          <span style={{fontSize:"16px",color:D.textMuted}}>🔍</span>
          <input ref={inputRef} value={q} onChange={e=>{setQ(e.target.value);setAiMode(false);setAiAnswer("");}}
            onKeyDown={e=>{if(e.key==="Escape")onClose();if(e.key==="Enter")askGuru();}}
            placeholder="Search players, matches, staff… or ask StatGuru anything"
            style={{flex:1,background:"transparent",border:"none",outline:"none",fontFamily:D.body,fontSize:"14px",color:D.textPrimary,}}/>
          {looksLikeStat&&!aiMode&&(
            <button onClick={askGuru} className="pressBtn" style={{display:"flex",alignItems:"center",gap:"5px",padding:"5px 12px",borderRadius:D.pill,cursor:"pointer",background:`${D.violet}18`,border:`1px solid ${D.violet}44`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.violet,whiteSpace:"nowrap"}}>
              ✦ Ask StatGuru
            </button>
          )}
          <button onClick={onClose} className="pressBtn" style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"18px",lineHeight:1}}>×</button>
        </div>

        {/* AI Guru answer */}
        {aiMode&&(
          <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`,background:`${D.violet}0a`}}>
            <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px"}}>
              <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.violet,letterSpacing:"0.06em"}}>✦ STATGURU</span>
              {aiLoading&&<span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>thinking…</span>}
            </div>
            {aiLoading
              ? <div style={{display:"flex",gap:"4px"}}>{[0,1,2].map(i=><div key={i} style={{width:"6px",height:"6px",borderRadius:"50%",background:D.violet,opacity:0.5,animation:`pulse 1s ${i*0.2}s infinite`}}/>)}</div>
              : <div style={{fontFamily:D.body,fontSize:"13px",color:D.textSecondary,lineHeight:1.6}}>{aiAnswer}</div>
            }
          </div>
        )}

        {/* Search results */}
        {!aiMode&&results.length>0&&(
          <div style={{maxHeight:"360px",overflowY:"auto"}}>
            {results.map((r,i)=>(
              <button key={i} onClick={r.action} className="pressBtn" style={{width:"100%",display:"flex",alignItems:"center",gap:"12px",padding:"10px 16px",background:"transparent",border:"none",cursor:"pointer",textAlign:"left",borderBottom:`1px solid ${D.border}44`}}>
                <div style={{width:"28px",height:"28px",borderRadius:D.md,background:`${typeColor(r.type)}18`,border:`1px solid ${typeColor(r.type)}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"13px",flexShrink:0}}>{r.icon}</div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary}}>{r.label}</div>
                  <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,textTransform:"uppercase",letterSpacing:"0.04em"}}>{r.sub}</div>
                </div>
                <span style={{padding:"2px 7px",borderRadius:D.pill,background:`${typeColor(r.type)}14`,fontFamily:D.head,fontSize:"8px",fontWeight:700,color:typeColor(r.type),textTransform:"uppercase",letterSpacing:"0.06em"}}>{r.type}</span>
              </button>
            ))}
          </div>
        )}

        {/* Empty / hint state */}
        {!aiMode&&q.length<2&&(
          <div style={{padding:"20px 16px"}}>
            <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginBottom:"12px"}}>Quick Access</div>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
              {[["🏏 Players","profiles"],["📊 Analytics","analytics"],["🏆 Competitions","competitions"],["📅 Calendar","calendar"],["🌿 Fields","fields"]].map(([l,p])=>(
                <button key={p} onClick={()=>{onNav(p);onClose();}} className="pressBtn" style={{padding:"6px 12px",borderRadius:D.pill,cursor:"pointer",background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"10px",color:D.textMuted}}>{l}</button>
              ))}
            </div>
            <div style={{marginTop:"14px",padding:"10px 14px",borderRadius:D.md,background:`${D.violet}08`,border:`1px solid ${D.violet}22`}}>
              <span style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.violet}}>✦ StatGuru tip: </span>
              <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Try "What is James Whitfield's strike rate?" or "Who are the top bowlers this season?"</span>
            </div>
          </div>
        )}

        {/* No results */}
        {!aiMode&&q.length>=2&&results.length===0&&(
          <div style={{padding:"24px 16px",textAlign:"center"}}>
            <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,marginBottom:"10px"}}>No results for "{q}"</div>
            <button onClick={askGuru} className="pressBtn" style={{padding:"8px 18px",borderRadius:D.pill,cursor:"pointer",background:`${D.violet}18`,border:`1px solid ${D.violet}44`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.violet}}>✦ Ask StatGuru instead</button>
          </div>
        )}

        {/* Footer */}
        <div style={{padding:"8px 16px",borderTop:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"12px"}}>
          <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>↵ Enter to ask StatGuru</span>
          <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>Esc to close</span>
          <span style={{marginLeft:"auto",fontFamily:D.head,fontSize:"8px",fontWeight:700,color:D.violet}}>✦ StatGuru powered by Claude</span>
        </div>
      </div>
    </div>
  );
}

export { GlobalSearch };
