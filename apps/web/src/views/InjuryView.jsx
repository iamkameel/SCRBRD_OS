import { useEffect, useRef, useState } from "react";
import { D } from "../design/tokens.js";
import { pctDays, severityColor, today, withheld } from "../lib/format.js";
import { holdsCapability } from "../rbac/index.js";
import { signedIn } from "../lib/api.js";
import { holds } from "../lib/family.js";
import { Avatar, Badge, Card, KPICard, ProgressBar, ReadState, SectionHeader } from "../ui/primitives.jsx";
import { useLive } from "../lib/live.js";
import { readState } from "../lib/readState.js";
import { hasLeftSchool, injuryCounts, isOpenInjury, phaseWord, severityWord } from "../lib/injury.js";
import { InjuryHistory, RecordInjuryForm, ReviewForm, ReviewsDue } from "./injuryreview.jsx";

// ══════════════════════════════════════════════════════
//  INJURIES VIEW
//
//  Everybody who reads an injury reads it here, at their own tier: the
//  database masks the columns (db/09, db/111) and this screen draws what came
//  back. Three things are the physio's alone (GA-I19, medical.write): the
//  "Reviews due" list, the Record form and the Review form. None of them is
//  drawn for anybody else, and nobody else's screen asks for the list (D5).
//
//  Type is 12px at the smallest and every control is 44px tall.
// ══════════════════════════════════════════════════════

function InjuryView({ role }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  // Retry bumps the nonce both reads share: the same reads, the same role.
  const [nonce, setNonce] = useState(0);
  const playersRead = useLive("players", role, nonce);
  const PLAYERS = playersRead.rows;
  const [selId, setSelId] = useState(/** @type {string | null} */ (null));
  const injuriesRead = useLive("injuries", role, nonce);
  const injV = injuriesRead.rows;
  const sel = selId ? injV.find((i) => i.id === selId) ?? null : null;
  // "Active injuries 0" over a read that failed is a count nobody made, and it
  // is the figure a coach acts on. A count is drawn only of an answer (GA-I08).
  const injSaid = readState(injuriesRead, { what: "the injury list" });
  const injAnswered = injSaid.state === "ok" || injSaid.state === "empty";
  const plSaid = readState(playersRead, { what: "the players" });
  const plAnswered = plSaid.state === "ok" || plSaid.state === "empty";
  const n = (answered, v) => (answered ? v : "—");
  // A pupil reaches this screen through his own record (selfaccess) and reads
  // his own injuries only; the side's fitness count is the team-mates' health
  // (K3, db/55), drawn only for a role reading the status tier itself.
  const seesSide = holdsCapability(role, "medical.status.read");
  // Phase and severity are the nature tier; a status-only reader gets them NULL
  // from the view, so for that reader the first tile counts who is out
  // (restricted) and there is no phase tile (GA-I19 D7).
  const seesNature = holdsCapability(role, "medical.nature.read");
  const counts = injuryCounts(injV, { natureTier: seesNature, now: today });
  // The physio's three pieces. A courtesy to everybody else's screen, not a
  // gate: the functions behind the two forms refuse the same write from anyone.
  const physio = signedIn() && holds(role, "medical.write");

  const nameOf = (id) => PLAYERS.find((p) => p.id === id)?.name ?? "Player";

  const [recording, setRecording] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [saved, setSaved] = useState("");
  const recordBtn = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const reviewBtn = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const heading = useRef(/** @type {HTMLHeadingElement | null} */ (null));
  const opener = useRef(/** @type {HTMLElement | null} */ (null));
  const focusDetail = useRef(false);

  // Opening an injury (from the list or from the worklist) moves focus to its
  // heading, so a keyboard or screen-reader user lands where the page changed;
  // closing it hands focus back to what opened it.
  const open = (/** @type {string} */ id, /** @type {HTMLElement | null} */ from = null) => {
    opener.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    focusDetail.current = true;
    setReviewing(false);
    setSelId(id);
  };
  const close = () => {
    setSelId(null); setReviewing(false);
    const back = opener.current;
    requestAnimationFrame(() => { if (back && back.isConnected) back.focus(); else recordBtn.current?.focus(); });
  };
  useEffect(() => {
    if (sel && focusDetail.current) {
      focusDetail.current = false;
      heading.current?.focus();
      heading.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [sel?.id]);                                                    // eslint-disable-line react-hooks/exhaustive-deps -- on arrival at an injury only

  const afterSave = (/** @type {string} */ words, /** @type {React.RefObject<HTMLButtonElement | null>} */ back, /** @type {() => void} */ shut) => {
    shut(); setSaved(words); setNonce((x) => x + 1);
    requestAnimationFrame(() => back.current?.focus());
  };

  const text = { fontFamily: D.body, fontSize: "12px" };
  return (
    <div className="os-page">
      <SectionHeader title="Injury Management" sub="Tracker, return-to-play & rehab status" color={D.rose}
        actions={physio && (
          <button type="button" ref={recordBtn} className="pressBtn" data-testid="record-injury-open" aria-expanded={recording}
            onClick={() => { setSaved(""); setRecording((r) => !r); }}
            style={{minHeight:"44px",padding:"0 18px",borderRadius:D.pill,border:`1px solid ${D.border}`,background:"transparent",color:D.textPrimary,cursor:"pointer",fontFamily:D.head,fontSize:"13px",fontWeight:700}}>
            Record an injury
          </button>
        )}/>

      {saved && <p role="status" data-testid="injury-saved" style={{...text,fontSize:"14px",color:D.textPrimary,margin:"0 0 16px"}}>{saved}</p>}

      {physio && recording && (
        <div style={{marginBottom:"16px"}}>
          <RecordInjuryForm players={PLAYERS}
            onSaved={(words) => afterSave(words, recordBtn, () => setRecording(false))}
            onCancel={() => { setRecording(false); requestAnimationFrame(() => recordBtn.current?.focus()); }}/>
        </div>
      )}

      {/* The physio's worklist: her list alone, with no count anywhere else (D5, D8). */}
      {physio && (
        <div style={{marginBottom:"24px"}}>
          <ReviewsDue role={role} nonce={nonce} names={nameOf} onOpen={(id) => open(id)}/>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"12px",marginBottom:"24px"}}>
        {seesNature
          ? <KPICard label="Injured"        value={n(injAnswered, counts.injured)} icon="bandage" color={D.rose}/>
          : <KPICard label="Out"            value={n(injAnswered, counts.out)}     icon="bandage" color={D.rose}/>}
        {seesNature&&<KPICard label="Rehabilitating" value={n(injAnswered, counts.rehab)} icon="dumbbell" color={D.orange}/>}
        <KPICard label="Returning Soon"  value={n(injAnswered, counts.returningSoon)} icon="circle-check" color={D.amber}/>
        {seesSide&&<KPICard label="Available"       value={n(plAnswered, PLAYERS.filter(p=>p.fitness==="fit").length)} icon="footprints" color={D.emerald}/>}
      </div>
      {injSaid.state!=="ok"&&<Card sx={{marginBottom:"16px"}}><ReadState read={injSaid} onRetry={()=>setNonce(x=>x+1)} icon="bandage" testId="injuries-read-state"/></Card>}
      {injSaid.state==="ok"&&plSaid.state==="failed"&&<Card sx={{marginBottom:"16px"}}><ReadState compact read={plSaid} onRetry={()=>setNonce(x=>x+1)} testId="injuries-players-read-state"/></Card>}

      <div style={{display:"grid",gridTemplateColumns:"var(--g-side-r,1fr 340px)",gap:"16px",alignItems:"start"}}>
        <ul style={{display:"flex",flexDirection:"column",gap:"10px",listStyle:"none",margin:0,padding:0}} aria-label="Injuries">
          {injV.map(inj=>{
            const player = PLAYERS.find(p=>p.id===inj.player);
            const hasRtw = Boolean(inj.rtw);
            const pct = inj.phase==="cleared" ? 100 : hasRtw ? pctDays(inj.dateInj, inj.rtw) : null;
            const daysLeft = hasRtw ? Math.max(0,Math.ceil((new Date(inj.rtw)-today)/(1000*60*60*24))) : null;
            const sc = severityColor(inj.severity);
            const on = sel?.id===inj.id;
            return (
              <li key={inj.id}>
                <button type="button" onClick={(e)=>open(inj.id, e.currentTarget)} aria-pressed={on} data-testid={`injury-${inj.id}`}
                  className="card-hover" style={{
                    display:"block",width:"100%",textAlign:"left",cursor:"pointer",padding:"14px 16px",minHeight:"44px",
                    border:`1px solid ${on?sc+"55":D.border}`,borderRadius:D.lg,color:"inherit",
                    background:on?sc+"06":D.surf1,
                  }}>
                  <span style={{display:"flex",gap:"12px",alignItems:"flex-start"}}>
                    <Avatar name={player?.name||"?"} size={40} color={sc}/>
                    <span style={{flex:1,minWidth:0,display:"block"}}>
                      <span style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px",flexWrap:"wrap"}}>
                        <span style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>{player?.name}</span>
                        {severityWord(inj.severity)&&<Badge color={sc}>{severityWord(inj.severity)}</Badge>}
                        <Badge color={inj.restricted?D.rose:D.emerald}>{inj.restricted?"Restricted":"Not restricted"}</Badge>
                        {hasLeftSchool(inj)&&<Badge color={D.textMuted} data-testid={`left-school-${inj.id}`}>Left the school</Badge>}
                      </span>
                      <span style={{display:"block",...text,fontWeight:500,color:inj.type?sc:D.textMuted,marginBottom:"4px",overflowWrap:"anywhere",fontStyle:inj.type?"normal":"italic"}}>{withheld(inj.type,"Details withheld")}</span>
                      <span style={{display:"block",...text,color:D.textMuted,marginBottom:"8px"}}>
                        Phase: <span style={{color:D.textSecondary,fontWeight:500}}>{withheld(phaseWord(inj.phase),"—")}</span>{inj.physio ? ` · Physio: ${inj.physio}` : ""}
                      </span>
                      {pct!==null&&(
                        <span style={{display:"block",marginBottom:"4px"}}>
                          <span style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                            <span style={{fontFamily:D.mono,...{fontSize:"12px"},color:D.textMuted}}>Recovery progress</span>
                            <span style={{fontFamily:D.mono,fontSize:"12px",color:sc,fontWeight:600}}>{pct}%</span>
                          </span>
                          <ProgressBar pct={pct} color={sc} height={6}/>
                        </span>
                      )}
                      <span style={{display:"flex",justifyContent:"space-between",gap:"8px",flexWrap:"wrap"}}>
                        <span style={{...text,color:D.textMuted}}>Injured: {inj.dateInj}</span>
                        <span style={{...text,color:daysLeft!==null&&daysLeft<=3?D.emerald:D.textMuted}}>{hasRtw?`RTW: ${inj.rtw} ${daysLeft===0?"TODAY":daysLeft<=3?`(${daysLeft}d)`:""}`:"RTW: not set"}</span>
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Detail panel */}
        {sel&&(()=>{
          const player = PLAYERS.find(p=>p.id===sel.player);
          const sc = severityColor(sel.severity);
          const hasRtw = Boolean(sel.rtw);
          const pct = sel.phase==="cleared" ? 100 : hasRtw ? pctDays(sel.dateInj, sel.rtw) : null;
          const daysLeft = hasRtw ? Math.max(0,Math.ceil((new Date(sel.rtw)-today)/(1000*60*60*24))) : null;
          const open_ = isOpenInjury(sel);
          const facts = [
            ["Phase",withheld(phaseWord(sel.phase),"—")],
            ["Physio",withheld(sel.physio,"—")],
            ["Date Injured",sel.dateInj],
            ["Est. RTW",hasRtw?sel.rtw:"Not set"],
            ["Days Remaining",daysLeft===null?"—":`${daysLeft} days`],
            // The physio's clock: hers alone (D5). Nobody else is shown a review date.
            ...(physio && open_ && sel.nextReviewOn ? [["Next review",sel.nextReviewOn]] : []),
          ];
          return (
            <Card sx={{padding:"16px",position:"sticky",top:"16px"}} data-testid="injury-detail" role="region" aria-labelledby="injury-detail-title">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px"}}>
                <h3 id="injury-detail-title" ref={heading} tabIndex={-1} style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:D.textPrimary,margin:0}}>Injury Report</h3>
                <button type="button" onClick={close} aria-label="Close the injury report" data-testid="injury-close"
                  style={{minWidth:"44px",minHeight:"44px",background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"18px"}}><span aria-hidden="true">✕</span></button>
              </div>
              <div style={{textAlign:"center",padding:"16px",background:sc+"10",borderRadius:D.md,border:`1px solid ${sc}22`,marginBottom:"14px"}}>
                <Avatar name={player?.name||"?"} size={56} color={sc}/>
                <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary,marginTop:"10px"}}>{player?.name}</div>
                <div style={{...text,fontSize:"13px",color:sel.type?sc:D.textMuted,marginTop:"3px",fontWeight:500,fontStyle:sel.type?"normal":"italic"}}>{withheld(sel.type,"Details withheld")}</div>
                <div style={{display:"flex",justifyContent:"center",gap:"6px",flexWrap:"wrap",marginTop:"6px"}}>
                  {severityWord(sel.severity)&&<Badge color={sc}>{severityWord(sel.severity)}</Badge>}
                  {hasLeftSchool(sel)&&<Badge color={D.textMuted} data-testid="left-school-detail">Left the school</Badge>}
                </div>
                {hasLeftSchool(sel)&&<p style={{...text,color:D.textSecondary,margin:"8px 0 0"}}>{physio?"He has left the school. His record is kept for reading, and he is not on your list.":"He has left the school. His record is kept for reading."}</p>}
              </div>

              <dl style={{margin:0}}>
                {facts.map(([l,v])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",gap:"8px",padding:"7px 0",borderBottom:`1px solid ${D.border}`}}>
                    <dt style={{...text,color:D.textMuted}}>{l}</dt>
                    <dd style={{fontFamily:D.mono,fontSize:"12px",margin:0,color:l==="Days Remaining"&&daysLeft!==null&&daysLeft<=3?D.emerald:D.textPrimary,fontWeight:500}}>{v}</dd>
                  </div>
                ))}
              </dl>

              {pct!==null&&(
                <div style={{marginTop:"12px",marginBottom:"12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:"6px"}}>
                    <span style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textMuted,letterSpacing:"0.06em"}}>RECOVERY</span>
                    <span style={{fontFamily:D.mono,fontSize:"12px",color:sc}}>{pct}%</span>
                  </div>
                  <ProgressBar pct={pct} color={sc} height={8}/>
                </div>
              )}

              {/* The clinical note is drawn where the database returned one: the clinical tier, and no further. */}
              {sel.notes&&(
                <div style={{background:D.surf2,borderRadius:D.md,padding:"10px 12px",margin:"12px 0"}} data-testid="injury-clinical-notes">
                  <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"6px"}}>CLINICAL NOTES</div>
                  <p style={{...text,fontSize:"13px",color:D.textSecondary,lineHeight:1.5,margin:0}}>{sel.notes}</p>
                </div>
              )}

              {physio&&(
                <div style={{display:"grid",gap:"12px",margin:"12px 0"}}>
                  {open_ ? (
                    <button type="button" ref={reviewBtn} className="pressBtn" data-testid="review-open" aria-expanded={reviewing}
                      onClick={()=>{setSaved("");setReviewing(r=>!r);}}
                      style={{minHeight:"44px",padding:"0 18px",borderRadius:D.pill,border:`1px solid ${D.border}`,background:"transparent",color:D.textPrimary,cursor:"pointer",fontFamily:D.head,fontSize:"13px",fontWeight:700}}>
                      Review this injury
                    </button>
                  ) : (
                    <p style={{...text,fontSize:"13px",color:D.textSecondary,margin:0}} data-testid="review-closed">This injury is cleared. If he is hurt again, record a new injury.</p>
                  )}
                  {open_&&reviewing&&(
                    <ReviewForm key={sel.id} injury={sel}
                      onSaved={(words)=>afterSave(words, reviewBtn, ()=>setReviewing(false))}
                      onCancel={()=>{setReviewing(false);requestAnimationFrame(()=>reviewBtn.current?.focus());}}/>
                  )}
                </div>
              )}

              <div style={{marginTop:"12px"}}>
                <InjuryHistory injuryId={sel.id} role={role} nonce={nonce} physio={physio} recordingNote={sel.notes}/>
              </div>
            </Card>
          );
        })()}
      </div>

    </div>
  );
}

export { InjuryView };
