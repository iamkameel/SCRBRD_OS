import { useEffect, useRef, useState } from "react";
import { DISMISSAL, DISMISSAL_LABEL, INNINGS_END_REASON, NB_RUNS } from "@scrbrd/scoring";
import { D, T } from "../design/tokens.js";
import { armHandover, cancelHandover, claimHandover, refusalWords, sessionState, verifyTakeover } from "../lib/handover.js";
import { fmtOv } from "./format.js";
import { SHOT_CATEGORIES } from "./shots.js";
import { INT_TEAMS, ROLE_COLORS } from "./teams.js";
import { Badge, Btn, CaptureProfilePicker, Lbl, Sep, Sheet } from "./ui.jsx";
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
  // Whose the runs are (SCRBRD-068): off the bat they are the striker's; byes
  // or leg byes off a no-ball are not (Law 23) — they are no-ball extras, and
  // the bowler is charged every run of a no-ball either way (Law 21).
  // null is off the bat, the event's default, so it is not written.
  const[from,setFrom]=useState(null);
  const FROM=[{id:null,label:"Off the bat"},{id:NB_RUNS.BYES,label:"Byes"},{id:NB_RUNS.LEG_BYES,label:"Leg byes"}];
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
          <Lbl sx={{marginBottom:"8px"}}>Runs Completed Off This Ball</Lbl>
          <div style={{display:"flex",gap:"6px"}}>
            {[0,1,2,3,4,5,6].map(r=>(
              <button key={r} data-testid={`nb-run-${r}`} onClick={()=>setRuns(r)} className="pressBtn" style={{
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
        {runs>0&&(
          <div data-testid="nb-runs-from">
            <Lbl sx={{marginBottom:"8px"}}>Off the bat, or byes / leg byes?</Lbl>
            <div style={{display:"flex",gap:"6px"}}>
              {FROM.map(f=>(
                <button key={f.label} type="button" data-testid={`nb-runs-${f.id??"bat"}`} onClick={()=>setFrom(f.id)} className="pressBtn" style={{
                  flex:1,padding:"10px 0",borderRadius:D.md,cursor:"pointer",fontFamily:D.body,fontSize:"12px",fontWeight:600,
                  border:`1px solid ${from===f.id?D.amber+"77":D.border}`,background:from===f.id?`${D.amber}1a`:D.surf2,
                  color:from===f.id?D.amber:D.textMuted}}>{f.label}</button>
              ))}
            </div>
            <div style={{marginTop:"6px",color:D.textMuted,fontSize:"11px",fontFamily:D.body}}>
              {from?"Not the batter's: no-ball extras, charged to the bowler.":"Credited to the batter."}
            </div>
          </div>
        )}
        <Btn variant="amber" size="lg" full data-testid="nb-confirm" onClick={()=>onConfirm(nbType,runs,runs>0?from:null)} sx={{borderRadius:D.md}}>
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
   REVISION SHEET — the umpires cut the overs / reset the target
═══════════════════════════════════════════════════════ */
// No DLS here. The figures are the umpires', read off their sheet and typed;
// a wrong automatic target is worse than a typed one, and a school ground
// has no resource tables. What this records is WHAT was set, by whom, when.
function RevisionSheet({overs,target,isChase,onConfirm,onClose}){
  const[newOvers,setNewOvers]=useState(String(overs??20));
  const[newTarget,setNewTarget]=useState(target!=null?String(target):"");
  const[reason,setReason]=useState("rain");
  const ov=parseInt(newOvers,10), tg=newTarget===""?null:parseInt(newTarget,10);
  const valid=Number.isInteger(ov)&&ov>=1&&ov<=(overs??20)&&(tg===null||(Number.isInteger(tg)&&tg>=1));
  return (
    <Sheet title="Revise the innings" accent={D.amber} onClose={onClose}>
      <div style={{paddingTop:"14px",display:"flex",flexDirection:"column",gap:"14px"}}>
        <div>
          <Lbl sx={{marginBottom:"8px"}}>Overs (was {overs})</Lbl>
          <input data-testid="revise-overs" inputMode="numeric" value={newOvers} onChange={e=>setNewOvers(e.target.value)}
            style={{width:"100%",padding:"11px 14px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.mono,fontSize:"18px",color:D.textPrimary,boxSizing:"border-box"}}/>
        </div>
        {isChase&&(
          <div>
            <Lbl sx={{marginBottom:"8px"}}>Target (was {target})</Lbl>
            <input data-testid="revise-target" inputMode="numeric" value={newTarget} onChange={e=>setNewTarget(e.target.value)}
              style={{width:"100%",padding:"11px 14px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.mono,fontSize:"18px",color:D.textPrimary,boxSizing:"border-box"}}/>
          </div>
        )}
        <div>
          <Lbl sx={{marginBottom:"8px"}}>Reason</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
            {["rain","bad light","late start","ground unfit","other"].map(r=>(
              <button key={r} onClick={()=>setReason(r)} className="pressBtn" style={{
                padding:"5px 10px",borderRadius:D.pill,cursor:"pointer",fontFamily:D.body,fontSize:"11px",fontWeight:500,
                border:`1px solid ${reason===r?D.amber+"55":D.border}`,background:reason===r?`${D.amber}14`:D.surf2,
                color:reason===r?D.amber:D.textMuted,transition:"all .15s"}}>{r}</button>
            ))}
          </div>
        </div>
        <Btn variant="primary" full disabled={!valid} data-testid="revise-confirm" onClick={()=>onConfirm({overs:ov,target:tg,reason})} sx={{
          borderRadius:D.md,background:`linear-gradient(135deg,${D.amber},${D.orange})`}}>
          {isChase&&tg!=null?`Revise to ${ov} overs, target ${tg}`:`Revise to ${ov} overs`}
        </Btn>
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════
   HANDOVER SHEET — the scoring-session token, changing hands (SCRBRD-056)
═══════════════════════════════════════════════════════ */
// Two tabs because two different devices use this screen: the outgoing
// scorer's phone arms a handover and reads the code aloud; the incoming
// scorer's phone — a different login, usually a different device — enters
// it. `startTab` opens straight on "take" when this device's own claim was
// refused because a handover is already pending (engine.jsx's sync effect
// sets that), so the person who needs to act next is not left on the wrong
// tab of their own screen.
const HANDOVER_POLL_MS = 2500;

function HandoverSheet({ matchId, device, epoch, pending, held = 0, onShowHeld, ballInFlight, startTab = "hand", onHandedOver, onClaimed, onTakenOver, onCancelled, onClose }) {
  const [tab, setTab] = useState(startTab);
  return (
    <Sheet title="Handover" accent={D.sky} onClose={onClose}>
      <div style={{paddingTop:"14px",display:"flex",flexDirection:"column",gap:"14px"}}>
        <div style={{display:"flex",gap:"6px"}}>
          {[["hand","Hand over"],["take","Take over"]].map(([id,label])=>(
            <button key={id} data-testid={`handover-tab-${id}`} onClick={()=>setTab(id)} className="pressBtn" style={{
              flex:1,padding:"9px",borderRadius:D.pill,cursor:"pointer",border:"none",
              fontFamily:D.head,fontSize:"11px",fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",
              background:tab===id?D.grad:D.surf2,color:tab===id?T.light.ink:D.textMuted}}>
              {label}
            </button>
          ))}
        </div>
        {tab==="hand"
          ? <HandOverTab matchId={matchId} device={device} epoch={epoch} pending={pending} held={held} onShowHeld={onShowHeld} ballInFlight={ballInFlight}
              onHandedOver={onHandedOver} onCancelled={onCancelled} onClose={onClose}/>
          : <TakeOverTab matchId={matchId} device={device} onClaimed={onClaimed} onTakenOver={onTakenOver} onClose={onClose}/>}
      </div>
    </Sheet>
  );
}

/** The outgoing scorer: arm, read the code aloud, wait, or change their mind. */
function HandOverTab({ matchId, device, epoch, pending, held = 0, onShowHeld, ballInFlight, onHandedOver, onCancelled, onClose }) {
  const [code, setCode] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [waitingFor, setWaitingFor] = useState(null); // name of whoever claimed it, once known
  const pollRef = useRef(null);
  // Set while this device takes its own token back: the "active" the poll
  // then reads is its own cancel, not a handover that completed.
  const cancellingRef = useRef(false);

  // Once armed, poll the session state a scorer may already read
  // (match_duties, fixture.read) for the handover completing, so this needs
  // no route of its own.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    pollRef.current = setInterval(async () => {
      const state = await sessionState(matchId);
      if (cancelled || cancellingRef.current) return;
      if (state === "verifying") setWaitingFor("verifying");
      else if (state === "active") {
        // Either genuinely handed over, or this device's own reclaim already
        // fired and cleared the local code — either way there is nothing left
        // to wait for on this screen. A read that failed (null) is not an
        // answer: it used to count as "handed over", and a blip of signal
        // while the code was up stopped the outbox of a device that still
        // held the token.
        clearInterval(pollRef.current);
        onHandedOver?.();
      }
    }, HANDOVER_POLL_MS);
    return () => { cancelled = true; clearInterval(pollRef.current); };
  }, [code, matchId, onHandedOver]);

  const arm = async () => {
    setBusy(true); setError(null);
    try {
      const r = await armHandover(matchId, { device, pending: 0, ballInFlight: false });
      if (r.ok) setCode(r.code);
      else setError(r.reason);
    } catch { setError("unreachable"); }
    setBusy(false);
  };

  const cancel = async () => {
    setBusy(true);
    cancellingRef.current = true;
    // The cancel is this device's own claim, and a claim bumps the epoch:
    // the outbox must go on under the generation it returns, or every ball
    // after the cancel is sent under the old one and quarantined (SCRBRD-078).
    let r = null;
    try { r = await cancelHandover(matchId, { device }); } catch { /* the poll above will settle it either way */ }
    clearInterval(pollRef.current);
    setCode(null); setBusy(false);
    if (r?.ok && r.epoch != null) onCancelled?.(r.epoch);
    onClose?.();
  };

  if (pending > 0) return (
    <div data-testid="handover-blocked-pending" style={{textAlign:"center",padding:"18px 8px",color:D.textSecondary,fontFamily:D.body,fontSize:"13px",lineHeight:1.6}}>
      <div style={{fontSize:"28px",marginBottom:"8px"}}>📡</div>
      <strong style={{color:D.amber}}>{pending} ball{pending===1?"":"s"} not yet uploaded.</strong><br/>
      Move to better signal before handing over — a handover with unsynced balls would leave them on this
      device only.
    </div>
  );
  if (ballInFlight) return (
    <div data-testid="handover-blocked-in-flight" style={{textAlign:"center",padding:"18px 8px",color:D.textSecondary,fontFamily:D.body,fontSize:"13px",lineHeight:1.6}}>
      Finish recording this ball first — a delivery started mid-entry cannot be handed over part-way through.
    </div>
  );

  if (!code) return (
    <>
      <div style={{color:D.textSecondary,fontFamily:D.body,fontSize:"13px",lineHeight:1.6,padding:"4px 2px"}}>
        Issues a six-digit code for the person taking over. Read it to them, or send it — it is not a
        password, only a claim ticket, and it expires the moment someone else claims this match's token.
      </div>
      {/* Held events (SCRBRD-070) are NOT in the outbox - the server
          refused them and wrote nothing - so they do not block a handover
          the way unsent balls do: there is nothing to wait for. But they
          are on this board and on no other, and the incoming scorer's
          check is against the server's replay, which leaves them out. Said
          here, with the way to them; the choice stays the scorer's. */}
      {held>0&&(
        <div data-testid="handover-held-warning" style={{background:`${D.rose}12`,border:`1px solid ${D.rose}44`,borderRadius:D.md,
          padding:"10px 12px",color:D.textSecondary,fontFamily:D.body,fontSize:"12.5px",lineHeight:1.55}}>
          <strong style={{color:D.roseText}}>{held} event{held===1?"":"s"} the server refused {held===1?"is":"are"} still on this device.</strong>{" "}
          The server does not have {held===1?"it":"them"}, so the scorer taking over will not see {held===1?"it":"them"}, and
          the score they confirm is the server's, without {held===1?"it":"them"}. Resolve {held===1?"it":"them"} first where possible,
          or hand over anyway: {held===1?"it stays":"they stay"} here on this device.
          {onShowHeld&&(
            <div style={{marginTop:"8px"}}>
              <Btn variant="ghost" size="sm" data-testid="handover-held-review" onClick={onShowHeld}>Review refused events</Btn>
            </div>
          )}
        </div>
      )}
      {error&&<div data-testid="handover-arm-error" style={{color:D.roseText,fontFamily:D.body,fontSize:"12px"}}>
        {error==="match_complete"?refusalWords(error):`Could not arm a handover (${error}).`}
      </div>}
      <Btn variant="primary" full disabled={busy} data-testid="handover-arm" onClick={arm}>
        {busy?"Arming…":"Hand over scoring"}
      </Btn>
    </>
  );

  return (
    <div style={{textAlign:"center",display:"flex",flexDirection:"column",gap:"14px"}}>
      <div>
        <Lbl sx={{marginBottom:"8px"}}>Give this code to the incoming scorer</Lbl>
        <div data-testid="handover-code" style={{fontFamily:D.mono,fontSize:"36px",fontWeight:700,letterSpacing:"0.15em",
          color:D.textPrimary,background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,padding:"16px"}}>
          {code}
        </div>
      </div>
      <div style={{color:D.textMuted,fontFamily:D.body,fontSize:"12px"}}>
        {waitingFor==="verifying"
          ? "They have the code — confirming the score now."
          : "Waiting for them to enter it…"}
      </div>
      <Btn variant="ghost" full disabled={busy} data-testid="handover-cancel" onClick={cancel}>
        {busy?"Cancelling…":"Cancel — keep scoring myself"}
      </Btn>
    </div>
  );
}

// Refusals the takeover can meet that are not a figure mismatch, said in words.
const REASON_FIELDS = { match_complete: 1, not_pending: 1, no_capability: 1, unreachable: 1 };

/** The incoming scorer: the code, then an INDEPENDENT read of the physical scoreboard. */
function TakeOverTab({ matchId, device, onClaimed, onTakenOver, onClose }) {
  const [code, setCode] = useState("");
  const [claimed, setClaimed] = useState(false);
  const [claimError, setClaimError] = useState(null);
  const [runs, setRuns] = useState(""); const [wickets, setWickets] = useState("");
  const [overs, setOvers] = useState(""); const [ballsInOver, setBallsInOver] = useState("");
  const [diff, setDiff] = useState(null);
  const [busy, setBusy] = useState(false);

  const claim = async () => {
    setBusy(true); setClaimError(null);
    try {
      const r = await claimHandover(matchId, { device, code: code.trim() });
      // The claim answers with the server's log (spec §4 step 2): the pad
      // rebuilds from it before the scorer is asked to confirm anything, and
      // never scores on over one of its own (SCRBRD-075).
      if (r.ok) { await onClaimed?.(r.events ?? []); setClaimed(true); }
      else setClaimError(r.reason);
    } catch { setClaimError("unreachable"); }
    setBusy(false);
  };

  const ov = parseInt(overs, 10), bo = parseInt(ballsInOver, 10);
  const ballsTotal = Number.isInteger(ov) && Number.isInteger(bo) ? ov * 6 + bo : NaN;
  const valid = /^\d{1,3}$/.test(runs) && /^\d{1,2}$/.test(wickets) && Number.isInteger(ballsTotal) && bo >= 0 && bo <= 5;

  const verify = async () => {
    setBusy(true); setDiff(null);
    const entered = { runs: parseInt(runs, 10), wickets: parseInt(wickets, 10), balls: ballsTotal };
    try {
      const r = await verifyTakeover(matchId, { device, ...entered });
      if (r.ok) { onTakenOver?.(r.epoch); onClose?.(); }
      else if (r.reason === "verify_mismatch" && r.exp_runs != null) {
        // scoring_verify_takeover returns exp_runs/exp_wkts/exp_balls flat,
        // not a diff array — the reference implementation's shape
        // (scoring-session.mjs's diffConfirmation) is a design double, not
        // what the live database function actually answers with. Built here
        // rather than asked of the server, which already told us everything
        // it has in those three fields.
        const FIELD = { runs: "Runs", wickets: "Wickets", balls: "Balls (total, this innings)" };
        const exp = { runs: r.exp_runs, wickets: r.exp_wkts, balls: r.exp_balls };
        setDiff(Object.keys(FIELD)
          .filter((f) => exp[f] !== entered[f])
          .map((f) => ({ field: FIELD[f], expected: exp[f], got: entered[f] })));
      } else setDiff([{ field: r.reason || "mismatch" }]);
    } catch { setDiff([{ field: "unreachable" }]); }
    setBusy(false);
  };

  if (!claimed) return (
    <>
      <div style={{color:D.textSecondary,fontFamily:D.body,fontSize:"13px",lineHeight:1.6,padding:"4px 2px"}}>
        Ask the outgoing scorer for the six-digit code shown on their screen.
      </div>
      <div>
        <Lbl sx={{marginBottom:"8px"}}>Code</Lbl>
        <input data-testid="handover-code-entry" inputMode="numeric" maxLength={6} value={code}
          onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))}
          style={{width:"100%",padding:"14px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,
            fontFamily:D.mono,fontSize:"26px",letterSpacing:"0.2em",textAlign:"center",color:D.textPrimary,boxSizing:"border-box"}}/>
      </div>
      {claimError&&<div data-testid="handover-claim-error" style={{color:D.roseText,fontFamily:D.body,fontSize:"12px"}}>
        {claimError==="verify_mismatch"?"That code doesn't match — check it and try again.":refusalWords(claimError)}
      </div>}
      <Btn variant="primary" full disabled={busy||code.length!==6} data-testid="handover-claim" onClick={claim}>
        {busy?"Claiming…":"Claim this match"}
      </Btn>
    </>
  );

  return (
    <>
      <div style={{color:D.textSecondary,fontFamily:D.body,fontSize:"13px",lineHeight:1.6,padding:"4px 2px"}}>
        Read the <strong>physical scoreboard</strong> — not this app — and type what it says. This is the
        check that catches a gap before it becomes a disputed scorecard, so it does not fill itself in.
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
        <div><Lbl sx={{marginBottom:"6px"}}>Runs</Lbl>
          <input data-testid="handover-verify-runs" inputMode="numeric" value={runs} onChange={e=>setRuns(e.target.value.replace(/\D/g,""))}
            style={{width:"100%",padding:"11px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.mono,fontSize:"18px",color:D.textPrimary,boxSizing:"border-box"}}/></div>
        <div><Lbl sx={{marginBottom:"6px"}}>Wickets</Lbl>
          <input data-testid="handover-verify-wickets" inputMode="numeric" value={wickets} onChange={e=>setWickets(e.target.value.replace(/\D/g,""))}
            style={{width:"100%",padding:"11px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.mono,fontSize:"18px",color:D.textPrimary,boxSizing:"border-box"}}/></div>
        <div><Lbl sx={{marginBottom:"6px"}}>Overs</Lbl>
          <input data-testid="handover-verify-overs" inputMode="numeric" value={overs} onChange={e=>setOvers(e.target.value.replace(/\D/g,""))}
            style={{width:"100%",padding:"11px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.mono,fontSize:"18px",color:D.textPrimary,boxSizing:"border-box"}}/></div>
        <div><Lbl sx={{marginBottom:"6px"}}>Balls (0–5)</Lbl>
          <input data-testid="handover-verify-balls" inputMode="numeric" value={ballsInOver} onChange={e=>setBallsInOver(e.target.value.replace(/\D/g,""))}
            style={{width:"100%",padding:"11px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.mono,fontSize:"18px",color:D.textPrimary,boxSizing:"border-box"}}/></div>
      </div>
      {diff&&(
        <div data-testid="handover-verify-mismatch" style={{color:D.roseText,fontFamily:D.body,fontSize:"12px",lineHeight:1.6,
          background:`${D.rose}0e`,border:`1px solid ${D.rose}33`,borderRadius:D.md,padding:"10px 12px"}}>
          <strong>That doesn't match the server's log.</strong>
          {diff.map((d,i)=>(
            <div key={i}>{d.expected!==undefined
              ? `${d.field}: expected ${d.expected}, entered ${d.got}`
              : d.field in REASON_FIELDS ? refusalWords(d.field) : `Reason: ${d.field}`}</div>
          ))}
        </div>
      )}
      <Btn variant="primary" full disabled={busy||!valid} data-testid="handover-verify-confirm" onClick={verify}>
        {busy?"Checking…":"Confirm and take over"}
      </Btn>
    </>
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

/**
 * `onTimedOut` is given only while an end is empty after a wicket or a
 * retirement — when Law 40 can apply (SCRBRD-081; the pad asks lawsRefusal).
 * It turns the sheet's pick into "this batter was timed out": a wicket with no
 * ball, recorded, and the sheet stays open for the batter who comes in.
 */
function BattingOrderSheet({squad,batsmen,teamKey,twelfthMan,onSend,onClose,header=null,onTimedOut=null}){
  const[timedOut,setTimedOut]=useState(false);
  const send=timedOut&&onTimedOut?(id)=>{setTimedOut(false);onTimedOut(id);}:onSend;
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
        {header&&<div style={{marginBottom:"14px"}}>{header}</div>}
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
        {onTimedOut&&(
          <button type="button" data-testid="timed-out-toggle" onClick={()=>setTimedOut(v=>!v)} className="pressBtn" style={{
            width:"100%",marginBottom:"12px",padding:"9px 12px",borderRadius:D.md,cursor:"pointer",textAlign:"left",
            border:`1px solid ${timedOut?D.rose+"55":D.border}`,background:timedOut?`${D.rose}12`:"transparent",
            fontFamily:D.body,fontSize:"12px",fontWeight:500,color:timedOut?D.roseText:D.textSecondary}}>
            {timedOut?"Timed out — tap the batter who did not arrive in time (Law 40)":"Incoming batter timed out?"}
          </button>
        )}
        {/* Available */}
        <Lbl sx={{marginBottom:"7px"}}>{timedOut?"Who was timed out?":"Available to Bat"}</Lbl>
        <div style={{display:"flex",flexDirection:"column",gap:"4px",marginBottom:"12px"}}>
          {available.map((p,i)=>{
            const ri=getRoleInfo(p.name);
            const pos=roster.findIndex(r=>r.id===p.id)+1;
            return (
              <button key={p.id} onClick={()=>send(p.id)} className="pressBtn" style={{
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
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.roseText}}>{b.runs}({b.balls})</span>
                </div>
              ))}
            </div>
          </details>
        )}
        <Sep sx={{marginBottom:"12px"}}/>
        <CustomBatEntry onSend={send}/>
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
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Player name…" aria-label="Player name"
          style={{flex:1,background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
            color:D.textPrimary,fontSize:"14px",fontFamily:D.body,fontWeight:500,padding:"10px 14px"}}
          onKeyDown={e=>{if(e.key==="Enter"&&name.trim())onSend(name.trim());}}/>
        <Btn variant="live" disabled={!name.trim()} onClick={()=>name.trim()&&onSend(name.trim())} sx={{borderRadius:D.md,padding:"10px 18px"}}>Go</Btn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   WICKET SHEET
═══════════════════════════════════════════════════════ */
function WicketSheet({batName,striker=null,nonStriker=null,fieldingSquad,onClose,onConfirm}){
  const[mode,setMode]=useState(DISMISSAL.BOWLED);
  const[fielder,setFielder]=useState("");
  const[fielterFilter,setFielderFilter]=useState("");
  // Whose wicket, where the mode leaves it open. Retired out is either
  // batter's; the rest default to the striker, as the event does.
  const[who,setWho]=useState(striker?.id??null);
  // The Laws' ways out, from the one list the reducer and the API read. The
  // button shows the label; the event carries the canonical value. Timed out
  // is not here: it is the INCOMING batter's (Law 40), who is never at the
  // crease while this sheet is open — the batting-order sheet offers it while
  // an end is empty (SCRBRD-081). Retired out is here, and is recorded as the
  // dismissal with no ball it is, not as a delivery.
  const modes=Object.keys(DISMISSAL_LABEL).filter(m=>m!==DISMISSAL.TIMED_OUT);
  // A run out: who, how many runs were completed first, and — when some
  // were, so the batters have crossed (Law 18) — at which end the wicket was
  // put down (Law 38.2). That end is the one left empty (SCRBRD-069).
  const[runs,setRuns]=useState(0);
  const[end,setEnd]=useState(null);
  const isRunOut=mode===DISMISSAL.RUN_OUT;
  const asksWho=(mode===DISMISSAL.RETIRED_OUT||isRunOut)&&striker&&nonStriker;
  const asksEnd=isRunOut&&runs>0;
  const needsFielder=mode===DISMISSAL.CAUGHT||mode===DISMISSAL.RUN_OUT;
  const isStumped=mode===DISMISSAL.STUMPED;
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
    setWho(striker?.id??null);
    setRuns(0);setEnd(null);
    if(m===DISMISSAL.STUMPED&&wkName)setFielder(wkName);
  };
  const whoName=who===nonStriker?.id?nonStriker?.name:(striker?.name??batName);
  const pill=(on)=>({flex:1,padding:"10px",borderRadius:D.md,cursor:"pointer",fontFamily:D.body,fontSize:"13px",fontWeight:500,
    border:"1px solid "+(on?D.rose+"55":D.border),background:on?D.rose+"1a":D.surf2,color:on?D.roseText:D.textSecondary});
  return (
    <Sheet title="WICKET!" accent={D.rose} onClose={onClose}>
      <div style={{color:D.textSecondary,fontSize:"13px",fontFamily:D.body,marginBottom:"14px",paddingTop:"4px"}}>
        {asksWho?whoName:batName} is dismissed
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px",marginBottom:"14px"}}>
        {modes.map(m=>(
          <button key={m} data-testid={`wicket-mode-${m}`} onClick={()=>handleMode(m)} className="pressBtn" style={{
            padding:"11px",borderRadius:D.md,cursor:"pointer",fontFamily:D.body,fontSize:"13px",fontWeight:500,
            border:"1px solid "+(mode===m?D.rose+"55":D.border),
            background:mode===m?D.rose+"1a":D.surf2,
            color:mode===m?D.roseText:D.textSecondary,transition:"all .15s"}}>
            {DISMISSAL_LABEL[m]}
          </button>
        ))}
      </div>
      {asksWho&&(
        <div style={{marginBottom:"12px"}}>
          <Lbl sx={{marginBottom:"7px"}}>Who is out?</Lbl>
          <div style={{display:"flex",gap:"7px"}}>
            <button data-testid="wicket-who-striker" onClick={()=>setWho(striker.id)} className="pressBtn" style={pill(who===striker.id)}>{striker.name}</button>
            <button data-testid="wicket-who-nonstriker" onClick={()=>setWho(nonStriker.id)} className="pressBtn" style={pill(who===nonStriker.id)}>{nonStriker.name}</button>
          </div>
          {mode===DISMISSAL.RETIRED_OUT&&(
            <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginTop:"6px"}}>
              Recorded between deliveries: no ball of the over, nothing to the bowler.
            </div>
          )}
        </div>
      )}
      {isRunOut&&(
        <div style={{marginBottom:"12px"}}>
          <Lbl sx={{marginBottom:"7px"}}>Runs completed before the run out</Lbl>
          <div style={{display:"flex",gap:"7px"}}>
            {[0,1,2,3].map(r=>(
              <button key={r} data-testid={`wicket-runs-${r}`} onClick={()=>{setRuns(r);if(r===0)setEnd(null);}} className="pressBtn" style={pill(runs===r)}>{r}</button>
            ))}
          </div>
        </div>
      )}
      {asksEnd&&(
        <div data-testid="wicket-end" style={{marginBottom:"12px"}}>
          <Lbl sx={{marginBottom:"7px"}}>Out at the striker's end or the bowler's end?</Lbl>
          <div style={{display:"flex",gap:"7px"}}>
            <button data-testid="wicket-end-striker" onClick={()=>setEnd("striker_end")} className="pressBtn" style={pill(end==="striker_end")}>Striker's end</button>
            <button data-testid="wicket-end-bowler" onClick={()=>setEnd("bowler_end")} className="pressBtn" style={pill(end==="bowler_end")}>Bowler's end</button>
          </div>
          <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginTop:"6px"}}>
            The batters crossed for the runs; the end where the wicket was broken is the one left empty.
          </div>
        </div>
      )}
      {isStumped&&(
        <div style={{marginBottom:"12px",padding:"10px 13px",borderRadius:D.md,
          background:D.violet+"0e",border:"1px solid "+D.violet+"33"}}>
          <Lbl sx={{marginBottom:"4px",color:D.violetText}}>Wicketkeeper</Lbl>
          <div style={{fontFamily:D.body,fontSize:"13px",color:D.textPrimary,fontWeight:500}}>
            {wkName||"—"}
            {wkName&&<span style={{color:D.textMuted,fontSize:"11px",marginLeft:"6px"}}>(auto-assigned)</span>}
          </div>
        </div>
      )}
      {needsFielder&&fieldingSquad&&fieldingSquad.length>0&&(
        <div style={{marginBottom:"12px"}}>
          <Lbl sx={{marginBottom:"8px"}}>{mode==="Caught"?"Caught by":"Run out by"}</Lbl>
          <input value={fielterFilter} onChange={e=>setFielderFilter(e.target.value)} aria-label="Search fielders"
            placeholder="Search fielder…"
            style={{width:"100%",background:D.surf2,border:"1px solid "+D.border,borderRadius:D.md,
              color:D.textPrimary,fontSize:"13px",fontFamily:D.body,padding:"9px 13px",marginBottom:"8px"}}/>
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
            onChange={e=>setFielder(e.target.value)} placeholder="Type any name…" aria-label="Fielder not in the squad"
            style={{width:"100%",background:D.surf2,border:"1px solid "+D.border,borderRadius:D.md,marginTop:"6px",
              color:D.textPrimary,fontSize:"13px",fontFamily:D.body,padding:"9px 13px"}}/>
        </div>
      )}
      {needsFielder&&(!fieldingSquad||!fieldingSquad.length)&&(
        <div style={{marginBottom:"12px"}}>
          <Lbl sx={{marginBottom:"7px"}}>{mode==="Caught"?"Caught by":"Run out by"}</Lbl>
          <input value={fielder} onChange={e=>setFielder(e.target.value)} placeholder="Fielder name (optional)" aria-label="Fielder name, optional"
            style={{width:"100%",background:D.surf2,border:"1px solid "+D.border,borderRadius:D.md,
              color:D.textPrimary,fontSize:"13px",fontFamily:D.body,padding:"11px 14px"}}/>
        </div>
      )}
      <div style={{display:"flex",gap:"10px",marginTop:"4px"}}>
        <Btn variant="ghost" sx={{flex:1,borderRadius:D.md}} onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" sx={{flex:2,borderRadius:D.md}} data-testid="wicket-confirm" disabled={asksEnd&&!end}
          onClick={()=>{if(asksEnd&&!end)return;onConfirm(mode,displayFielder,{dismissed:asksWho&&who!==striker?.id?who:null,
            runs:isRunOut?runs:0,outAt:asksEnd?end:null});}}>Confirm Out</Btn>
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════
   NEW OVER / BOWLER SHEET
═══════════════════════════════════════════════════════ */
/**
 * `midOver` (SCRBRD-080): the over is under way, so this is a bowler taking
 * over from one who cannot finish it. Law 17.8.1 allows that only for an
 * injured or suspended bowler, so the sheet asks which before it offers
 * anyone, and passes it on: onConfirm(id, reason).
 */
function NewOverSheet({ovNum,prevBowlers,bowlingSquad,bowlingTeamKey,lastBowlerName,refuses,onClose,onConfirm:confirm,midOver=false}){
  const[name,setName]=useState("");
  const[filter,setFilter]=useState("");
  const[reason,setReason]=useState(null);
  const onConfirm=(id)=>{if(midOver&&!reason)return;confirm(id,midOver?reason:undefined);};
  const reasonPill=(on)=>({flex:1,padding:"10px",borderRadius:D.md,cursor:"pointer",fontFamily:D.body,fontSize:"13px",fontWeight:600,
    border:`1px solid ${on?D.amber+"77":D.border}`,background:on?`${D.amber}1a`:D.surf2,color:on?D.amber:D.textSecondary});
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
  // Can't bowl consecutive overs (Law 17.8). `refuses` is lawsRefusal() —
  // the rule the server applies when the bowler event arrives — asked by the
  // id that will be emitted. The name comparison is kept only for a caller
  // that does not pass it.
  // Mid-over, nobody is offered until the reason is chosen.
  const canBowl=(p)=>(!midOver||!!reason)&&(refuses?!refuses(p.id??p.name):p.name!==lastBowlerName);
  const prevBowlerMap={};
  prevBowlers.forEach(b=>{prevBowlerMap[b.name]=b;});
  return (
    <Sheet title={midOver?"Change of Bowler":ovNum===0?"Opening Bowler":`Over ${ovNum} Complete`} accent={D.amber} onClose={onClose}>
      <div style={{paddingTop:"8px"}}>
        {midOver&&(
          <div data-testid="bowler-change-reason" style={{marginBottom:"14px"}}>
            <Lbl sx={{marginBottom:"7px",color:D.amber}}>Injury or suspended?</Lbl>
            <div style={{display:"flex",gap:"7px"}}>
              <button type="button" data-testid="bowler-change-injury" onClick={()=>setReason("injury")} className="pressBtn" style={reasonPill(reason==="injury")}>Injury</button>
              <button type="button" data-testid="bowler-change-suspended" onClick={()=>setReason("suspended")} className="pressBtn" style={reasonPill(reason==="suspended")}>Suspended</button>
            </div>
            <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginTop:"6px"}}>
              Law 17.8.1: a bowler may be replaced during an over only when injured or suspended. Whoever finishes the over may not bowl the next.
            </div>
          </div>
        )}
        {!midOver&&(
        <div style={{color:D.textSecondary,fontSize:"12px",fontFamily:D.body,marginBottom:"14px"}}>
          {ovNum===0?"Select the opening bowler.":`Select bowler for over ${ovNum+1}.`}
          {lastBowlerName&&<span style={{color:D.textMuted}}> ({lastBowlerName} cannot bowl consecutive overs)</span>}
        </div>
        )}
        {/* Search filter */}
        <div style={{marginBottom:"12px"}}>
          <input value={filter} onChange={e=>setFilter(e.target.value)} aria-label="Search bowlers"
            placeholder="Search bowler…"
            style={{width:"100%",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
              color:D.textPrimary,fontSize:"14px",fontFamily:D.body,padding:"9px 14px"}}
            onFocus={e=>e.target.style.borderColor=D.amber+"66"}
            onBlur={e=>e.target.style.borderColor=D.border}/>
        </div>
        {/* Previously bowled this innings — quick pick */}
        {prevBowlers.length>0&&(
          <div style={{marginBottom:"12px"}}>
            <Lbl sx={{marginBottom:"7px",color:D.amber}}>Already Bowled This Innings</Lbl>
            <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
              {prevBowlers.map(b=>{
                const dis=!canBowl(b);
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
                      {dis&&(!midOver||reason)&&<div style={{fontFamily:D.body,fontSize:"10px",color:D.roseText,marginTop:"1px"}}>Cannot bowl consecutive overs</div>}
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
            const dis=!canBowl(player);
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
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Bowler name…" aria-label="Bowler name"
            style={{flex:1,background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
              color:D.textPrimary,fontSize:"14px",fontFamily:D.body,fontWeight:500,padding:"10px 14px"}}
            onFocus={e=>e.target.style.borderColor=D.amber+"66"} onBlur={e=>e.target.style.borderColor=D.border}
            onKeyDown={e=>{if(e.key==="Enter"&&name.trim()&&canBowl({name:name.trim()}))onConfirm(name.trim());}}/>
          <Btn variant="amber" disabled={!name.trim()||!canBowl({name:name.trim()})} onClick={()=>name.trim()&&canBowl({name:name.trim()})&&onConfirm(name.trim())} sx={{borderRadius:D.md,padding:"10px 18px"}}>Go</Btn>
        </div>
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════
   INNINGS BREAK SHEET
═══════════════════════════════════════════════════════ */
/**
 * The innings break is the second innings' setup, so it is where that innings
 * declares what it will capture (SCRBRD-039). It starts from whatever was
 * declared already — the from-scratch setup declares both innings up front —
 * and from nothing when nothing was, so a scorer who presses Start without
 * touching it changes nothing about how the match reads.
 */
function Innings2Sheet({target,teamName,overs,declared=null,onClose,onStart}){
  const[profile,setProfile]=useState(declared);
  return (
    <Sheet title="Innings Break" accent={D.indigo} onClose={onClose}>
      <div style={{textAlign:"center",padding:"20px 0 24px"}}>
        <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted,marginBottom:"8px"}}>{teamName} need</div>
        <div style={{fontFamily:D.mono,fontSize:"clamp(56px,12vw,80px)",fontWeight:500,
          background:D.grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",
          lineHeight:1,letterSpacing:"-0.02em",marginBottom:"6px"}}>{target}</div>
        <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted,marginBottom:"24px"}}>runs to win in {overs} overs</div>
        <div style={{textAlign:"left",maxWidth:"360px",margin:"0 auto 20px"}}>
          <CaptureProfilePicker value={profile} onChange={setProfile}/>
        </div>
        <Btn variant="primary" size="lg" sx={{borderRadius:D.md,minWidth:"220px"}} onClick={()=>onStart(profile)}>Start 2nd Innings →</Btn>
      </div>
    </Sheet>
  );
}


/* ═══════════════════════════════════════════════════════
   INNINGS REVIEW SHEET — SCRBRD-038

   The checkpoint between the last ball and a closed innings.

   Before this, the ball that completed an innings also closed it: the engine
   read `complete` off the projection and went straight to the innings break or
   the result screen. Nothing was wrong with the arithmetic — the fold is the
   same fold — but the scorer never saw the total they were committing to, and
   an innings sealed on a mis-tapped six is the most expensive error in the
   app to unpick afterwards. It needs the correction workflow, which needs an
   approval from somebody who is not the scorer.

   So: read it back first. The figures here are all derived, never entered —
   this sheet cannot change the innings, only show it and ask.

   Three ways out, and all three are honest:
     - Confirm       → an innings_end event carrying the derived reason, and
                       the innings is closed in the log rather than inferred
                       from it on every replay.
     - Fix last ball → undo, which un-completes the innings and returns to
                       scoring. The scorer said the figures are wrong; the
                       last ball is the one that can still be taken back.
     - Close (Esc)   → neither. The innings stays over and unconfirmed, and
                       the banner on the scoring screen brings this back. A
                       checkpoint that traps the scorer would be worked around
                       within a week.
═══════════════════════════════════════════════════════ */
const END_REASON_TEXT = Object.freeze({
  [INNINGS_END_REASON.ALL_OUT]:   "All out",
  [INNINGS_END_REASON.OVERS]:     "Overs complete",
  [INNINGS_END_REASON.TARGET]:    "Target reached",
  [INNINGS_END_REASON.DECLARED]:  "Declared",
  [INNINGS_END_REASON.ABANDONED]: "Abandoned",
});

function InningsReviewSheet({inn,inningsNo,onConfirm,onFixLastBall,onClose}){
  const notOut=(inn?.batsmen||[]).filter(b=>b.status==="batting");
  // Only bowlers who actually bowled. A name with no balls against it is a
  // squad entry, not a spell, and reading one back as "0-0 off 0" invites the
  // scorer to wonder what they got wrong.
  const spells=(inn?.bowlers||[]).filter(b=>b.balls>0).sort((a,b)=>b.wickets-a.wickets||a.runs-b.runs).slice(0,3);
  const ex=inn?.extras||{};
  const extrasTotal=(ex.wide||0)+(ex.noBall||0)+(ex.bye||0)+(ex.legBye||0)+(ex.penalty||0);
  const reason=END_REASON_TEXT[inn?.endReason]??"Innings over";
  const row={display:"flex",justifyContent:"space-between",alignItems:"baseline",
    padding:"7px 0",borderBottom:`1px solid ${D.border}`,fontFamily:D.body,fontSize:"13px"};

  return (
    <Sheet title={`Innings ${inningsNo} — check before closing`} accent={D.amber} onClose={onClose}>
      <div style={{paddingTop:"10px"}} data-testid="innings-review">
        <div style={{textAlign:"center",marginBottom:"18px"}}>
          <div style={{fontFamily:D.mono,fontSize:"clamp(44px,10vw,64px)",fontWeight:500,
            color:D.textPrimary,lineHeight:1,letterSpacing:"-0.02em"}} data-testid="review-score">
            {inn?.runs??0}/{inn?.wickets??0}
          </div>
          <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted,marginTop:"6px"}} data-testid="review-overs">
            {fmtOv(inn?.balls??0)} overs
          </div>
          <div style={{marginTop:"10px"}}>
            <Badge color={D.amber} data-testid="review-reason">{reason}</Badge>
          </div>
        </div>

        <Lbl sx={{marginBottom:"4px"}}>At the crease</Lbl>
        {notOut.length===0
          ? <div style={{...row,color:D.textMuted}} data-testid="review-nobody-in">Nobody not out</div>
          : notOut.map(b=>(
              <div key={b.id} style={row} data-testid={`review-batter-${b.id}`}>
                <span style={{color:D.textPrimary}}>{b.name}</span>
                <span style={{fontFamily:D.mono,color:D.textSecondary}}>{b.runs}* ({b.balls})</span>
              </div>))}

        <Lbl sx={{marginTop:"14px",marginBottom:"4px"}}>Extras</Lbl>
        <div style={row} data-testid="review-extras">
          <span style={{color:D.textPrimary}}>{extrasTotal}</span>
          <span style={{fontFamily:D.mono,color:D.textSecondary,fontSize:"12px"}}>
            {`${ex.wide||0}w ${ex.noBall||0}nb ${ex.bye||0}b ${ex.legBye||0}lb${ex.penalty?` ${ex.penalty}p`:""}`}
          </span>
        </div>

        {spells.length>0&&<>
          <Lbl sx={{marginTop:"14px",marginBottom:"4px"}}>Leading figures</Lbl>
          {spells.map(b=>(
            <div key={b.id} style={row} data-testid={`review-bowler-${b.id}`}>
              <span style={{color:D.textPrimary}}>{b.name}</span>
              <span style={{fontFamily:D.mono,color:D.textSecondary}}>{b.wickets}-{b.runs} ({fmtOv(b.balls)})</span>
            </div>))}
        </>}

        <div style={{display:"flex",flexDirection:"column",gap:"8px",marginTop:"20px"}}>
          <Btn variant="primary" size="lg" sx={{borderRadius:D.md}}
            onClick={onConfirm} data-testid="review-confirm">
            That is right — close the innings
          </Btn>
          <Btn variant="ghost" size="md" sx={{borderRadius:D.md}}
            onClick={onFixLastBall} data-testid="review-fix">
            Take back the last ball
          </Btn>
        </div>
        <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,textAlign:"center",marginTop:"10px"}}>
          Once closed, changing this innings needs a correction the scorer cannot approve alone.
        </div>
      </div>
    </Sheet>
  );
}

export { BattingOrderSheet, CustomBatEntry, HandoverSheet, Innings2Sheet, InningsReviewSheet, NewOverSheet, NoBallSheet, PenaltySheet, RevisionSheet, ShotSelectorSheet, WicketSheet };
