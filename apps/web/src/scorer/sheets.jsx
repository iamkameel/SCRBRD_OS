import { useEffect, useRef, useState } from "react";
import { DISMISSAL, DISMISSAL_LABEL, INNINGS_END_REASON, NB_RUNS, dismissalsOffExtra } from "@scrbrd/scoring";
import { D, T } from "../design/tokens.js";
import { armHandover, cancelHandover, claimHandover, refusalWords, sessionState, verifyTakeover } from "../lib/handover.js";
import { fmtOv } from "./format.js";
import { SHOT_CATEGORIES } from "./shots.js";
import { INT_TEAMS, ROLE_COLORS } from "./teams.js";
import { Badge, Btn, CaptureProfilePicker, Lbl, Sep, Sheet } from "./ui.jsx";
import { Select } from "../ui/primitives.jsx";
import { Icon } from "../ui/icons.jsx";
import { batterChoices, bowlerChoices, unavailableWords } from "./prompts.js";
import { KeeperRow } from "./keeperSheet.jsx";
import { OFF_SIDE_ASK, OFF_SIDE_MARK, OFF_SIDE_WHY, offSide } from "./side.js";
import { Proposal, useProposal } from "./rainSheet.jsx";

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
                  style={{minHeight:"44px",padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",
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
function NoBallSheet({onConfirm,onClose,edition=3,freeHits=true}){
  const[nbType,setNbType]=useState("front_foot");
  const[runs,setRuns]=useState(0);
  // Whose the runs are (SCRBRD-068): off the bat they are the striker's, and
  // charged to the bowler; byes or leg byes off a no-ball are scored as byes
  // or leg byes, and are neither the striker's nor the bowler's (Law 21.15,
  // Law 23; db/52). The no-ball's own run is charged to the bowler either way.
  // null is off the bat, the event's default, so it is not written.
  const[from,setFrom]=useState(null);
  const FROM=[{id:null,label:"Off the bat"},{id:NB_RUNS.BYES,label:"Byes"},{id:NB_RUNS.LEG_BYES,label:"Leg byes"}];
  const[wicket,setWicket]=useState(false);
  // Off any no-ball a batter is out only run out, hit the ball twice or
  // obstructing the field (Law 21.17, 4th Edition; 21.18 in the 3rd).
  // Both: 1 penalty run + any runs scored (the bat's only when off the bat), doesn't count as legal delivery
  const types=[
    {id:"front_foot",label:"Front Foot",sub:"Bowler overstepped the crease",
      note:"Off a no ball a batter can be out only run out, hit the ball twice, or obstructing the field"},
    {id:"height",label:"Waist-high Full Toss",sub:"Passed above waist height without landing",
      note:"Same dismissals as front foot. Free hit applies in limited overs."},
    {id:"beamer",label:"Beamer (Dangerous)",sub:"Full toss above waist — dangerous delivery",
      note:"Umpire warning issued. Bowler may be removed. Same dismissal rules apply."},
  ];
  return (
    <Sheet title="No Ball" accent={D.amber} onClose={onClose}>
      <div style={{paddingTop:"14px",display:"flex",flexDirection:"column",gap:"14px"}}>
        {types.map(t=>(
          <button key={t.id} onClick={()=>setNbType(t.id)} className="pressBtn" style={{
            minHeight:"44px",padding:"12px 14px",borderRadius:D.md,cursor:"pointer",textAlign:"left",width:"100%",
            border:`1px solid ${nbType===t.id?D.amber+"66":D.border}`,
            background:nbType===t.id?`${D.amber}10`:D.surf2}}>
            <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:nbType===t.id?D.amber:D.textPrimary,marginBottom:"3px"}}>{t.label}</div>
            <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>{t.sub}</div>
          </button>
        ))}
        {/* Dismissal note */}
        <div style={{background:`${D.amber}0a`,border:`1px solid ${D.amber}22`,borderRadius:D.md,padding:"10px 14px"}}>
          <Lbl sx={{color:D.amber,marginBottom:"5px"}}>Dismissals Allowed</Lbl>
          <div style={{color:D.textSecondary,fontSize:"12px",fontFamily:D.body,lineHeight:1.5}}>
            {types.find(t=>t.id===nbType)?.note}
          </div>
          {/* Every no-ball, whatever its kind: the fold gives the free hit
              (SCORING_RULES §6), so the sheet says so for each. */}
          {/* The fold's answer (inn.freeHits): a free hit is a limited-overs
              playing condition, not given in a declaration or timed match
              (SCRBRD-113). */}
          {freeHits?(
            <div style={{marginTop:"6px",color:D.orange,fontSize:"12px",fontFamily:D.body,fontWeight:500}}>
              <Icon name="zap"/> Free hit on the next delivery
            </div>
          ):(
            <div data-testid="nb-no-free-hit" style={{marginTop:"6px",color:D.textSecondary,fontSize:"12px",fontFamily:D.body}}>
              No free hit in this match: the no ball is its run and another delivery.
            </div>
          )}
          {/* The Laws' 4th Edition (from 1 October 2026, SCRBRD-113). */}
          {edition===4&&(
            <div data-testid="nb-head-height" style={{marginTop:"6px",color:D.textSecondary,fontSize:"12px",fontFamily:D.body}}>
              A bouncer over head height is a wide, not a no ball.
            </div>
          )}
        </div>
        {/* Runs off the no ball */}
        <div>
          <Lbl sx={{marginBottom:"8px"}}>Runs Completed Off This Ball</Lbl>
          <div style={{display:"flex",gap:"6px"}}>
            {[0,1,2,3,4,5,6].map(r=>(
              <button key={r} data-testid={`nb-run-${r}`} onClick={()=>setRuns(r)} className="pressBtn" style={{
                flex:1,minHeight:"44px",padding:"11px 0",borderRadius:D.md,cursor:"pointer",
                fontFamily:D.mono,fontSize:"15px",fontWeight:500,
                border:`1px solid ${runs===r?D.amber+"77":D.border}`,
                background:runs===r?`${D.amber}1a`:D.surf2,
                color:runs===r?D.amber:D.textMuted,transition:"all .2s",
              }}>{r}</button>
            ))}
          </div>
          <div style={{marginTop:"6px",color:D.textMuted,fontSize:"12px",fontFamily:D.body}}>
            +1 penalty run added automatically. Total: <span style={{color:D.amber,fontFamily:D.mono,fontWeight:500}}>{runs+1}</span> runs to batting team.
          </div>
        </div>
        {runs>0&&(
          <div data-testid="nb-runs-from">
            <Lbl sx={{marginBottom:"8px"}}>Off the bat, or byes / leg byes?</Lbl>
            <div style={{display:"flex",gap:"6px"}}>
              {FROM.map(f=>(
                <button key={f.label} type="button" data-testid={`nb-runs-${f.id??"bat"}`} onClick={()=>setFrom(f.id)} className="pressBtn" style={{
                  flex:1,minHeight:"44px",padding:"10px 0",borderRadius:D.md,cursor:"pointer",fontFamily:D.body,fontSize:"12px",fontWeight:600,
                  border:`1px solid ${from===f.id?D.amber+"77":D.border}`,background:from===f.id?`${D.amber}1a`:D.surf2,
                  color:from===f.id?D.amber:D.textMuted}}>{f.label}</button>
              ))}
            </div>
            <div style={{marginTop:"6px",color:D.textMuted,fontSize:"12px",fontFamily:D.body}}>
              {from===NB_RUNS.LEG_BYES?"Scored as leg byes: not the batter's, and not charged to the bowler."
                :from?"Scored as byes: not the batter's, and not charged to the bowler."
                :"Credited to the batter, and charged to the bowler."}
            </div>
          </div>
        )}
        {/* And a wicket? (Law 21.17): off a no ball only run out, hit the
            ball twice or obstructing the field. Yes moves on to the wicket
            sheet, which offers just those; nothing is recorded until it
            confirms. */}
        <div data-testid="nb-wicket">
          <Lbl sx={{marginBottom:"8px"}}>And a wicket?</Lbl>
          <div style={{display:"flex",gap:"6px"}}>
            {[[false,"No"],[true,"Yes"]].map(([on,label])=>(
              <button key={label} type="button" data-testid={`nb-wicket-${on?"yes":"no"}`} aria-pressed={wicket===on} onClick={()=>setWicket(on)} className="pressBtn" style={{
                flex:1,minHeight:"44px",padding:"10px 0",borderRadius:D.md,cursor:"pointer",fontFamily:D.body,fontSize:"13px",fontWeight:600,
                border:`1px solid ${wicket===on?D.rose+"77":D.border}`,background:wicket===on?`${D.rose}1a`:D.surf2,
                color:wicket===on?D.roseText:D.textMuted}}>{label}</button>
            ))}
          </div>
          {wicket&&(
            <div style={{marginTop:"6px",color:D.textMuted,fontSize:"12px",fontFamily:D.body}}>
              Next: run out, hit the ball twice or obstructing the field.
            </div>
          )}
        </div>
        <Btn variant="amber" size="lg" full data-testid="nb-confirm" onClick={()=>onConfirm(nbType,runs,runs>0?from:null,wicket)} sx={{borderRadius:D.md}}>
          {wicket?"Next: the wicket":`Confirm No Ball (${runs+1} runs)`}
        </Btn>
      </div>
    </Sheet>
  );
}

/* The penalty runs sheet is penaltySheet.jsx (SCRBRD-094). */

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
                minHeight:"44px",padding:"5px 14px",borderRadius:D.pill,cursor:"pointer",fontFamily:D.body,fontSize:"12px",fontWeight:500,
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

function HandoverSheet({ matchId, device, epoch, pending, held = 0, onShowHeld, ballInFlight, startTab = "hand", onHandedOver, onClaimed, onTakenOver, onCancelled, onClose, conditionsHash }) {
  const [tab, setTab] = useState(startTab);
  return (
    <Sheet title="Handover" accent={D.sky} onClose={onClose}>
      <div style={{paddingTop:"14px",display:"flex",flexDirection:"column",gap:"14px"}}>
        <div style={{display:"flex",gap:"6px"}}>
          {[["hand","Hand over"],["take","Take over"]].map(([id,label])=>(
            <button key={id} data-testid={`handover-tab-${id}`} onClick={()=>setTab(id)} className="pressBtn" style={{
              flex:1,minHeight:"44px",padding:"9px",borderRadius:D.pill,cursor:"pointer",border:"none",
              fontFamily:T.type.body,fontSize:"13px",fontWeight:700,letterSpacing:"0.03em",textTransform:"uppercase",
              background:tab===id?D.grad:T.surface.interactive,color:tab===id?T.light.ink:T.content.tertiary}}>
              {label}
            </button>
          ))}
        </div>
        {tab==="hand"
          ? <HandOverTab matchId={matchId} device={device} epoch={epoch} pending={pending} held={held} onShowHeld={onShowHeld} ballInFlight={ballInFlight}
              onHandedOver={onHandedOver} onCancelled={onCancelled} onClose={onClose}/>
          : <TakeOverTab matchId={matchId} device={device} onClaimed={onClaimed} onTakenOver={onTakenOver} onClose={onClose} conditionsHash={conditionsHash}/>}
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
      <div style={{fontSize:"28px",marginBottom:"8px"}}><Icon name="radio-tower"/></div>
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
const REASON_FIELDS = { match_complete: 1, not_pending: 1, no_capability: 1, unreachable: 1, conditions_changed: 1 };

/** The incoming scorer: the code, then an INDEPENDENT read of the physical scoreboard. */
function TakeOverTab({ matchId, device, onClaimed, onTakenOver, onClose, conditionsHash }) {
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
      // ...and how to fold it (SCRBRD-113/114): the fixture's start and
      // format and the match's playing conditions, adopted with the log.
      if (r.ok) { await onClaimed?.(r.events ?? [], r.fold ?? null); setClaimed(true); }
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
      // The playing conditions this device folded under go first (SCRBRD-114):
      // the server refuses a stale set in words before it reads the board.
      const r = await verifyTakeover(matchId, { device, ...entered, conditionsHash: typeof conditionsHash === "function" ? conditionsHash() : conditionsHash });
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
            style={{width:"100%",minHeight:"44px",padding:"11px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.mono,fontSize:"18px",color:D.textPrimary,boxSizing:"border-box"}}/></div>
        <div><Lbl sx={{marginBottom:"6px"}}>Wickets</Lbl>
          <input data-testid="handover-verify-wickets" inputMode="numeric" value={wickets} onChange={e=>setWickets(e.target.value.replace(/\D/g,""))}
            style={{width:"100%",minHeight:"44px",padding:"11px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.mono,fontSize:"18px",color:D.textPrimary,boxSizing:"border-box"}}/></div>
        <div><Lbl sx={{marginBottom:"6px"}}>Overs</Lbl>
          <input data-testid="handover-verify-overs" inputMode="numeric" value={overs} onChange={e=>setOvers(e.target.value.replace(/\D/g,""))}
            style={{width:"100%",minHeight:"44px",padding:"11px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.mono,fontSize:"18px",color:D.textPrimary,boxSizing:"border-box"}}/></div>
        <div><Lbl sx={{marginBottom:"6px"}}>Balls (0–5)</Lbl>
          <input data-testid="handover-verify-balls" inputMode="numeric" value={ballsInOver} onChange={e=>setBallsInOver(e.target.value.replace(/\D/g,""))}
            style={{width:"100%",minHeight:"44px",padding:"11px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.mono,fontSize:"18px",color:D.textPrimary,boxSizing:"border-box"}}/></div>
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
 *
 * `resumable` is the batters retired hurt whom the Laws would take back at
 * the end this sheet fills (retire.js resumeChoices, SCRBRD-071) — the
 * engine asks; the sheet offers exactly those, and none when not told.
 *
 * `resumableWithConsent` is the batters retired out whom the Laws would take
 * back with the opposing captain's consent (retire.js consentChoices; Law
 * 25.4.3). A tap asks the scorer to confirm the captain agreed; only the
 * confirm sends, as onSend(id, {captainConsent: true}).
 */
// `typed` (scorer/side.js mayType): whether a name may be typed in straight
// away. False on an end whose coach named the side: a typed boy is not linked
// to his record, so the checks the side passed would not follow him. There
// `onlyNamed` is said, the typed field waits behind OffSideEntry, and a boy
// typed in is marked where his figures are shown.
function BattingOrderSheet({squad,batsmen,teamKey,twelfthMan,onSend,onClose,header=null,onTimedOut=null,resumable=[],resumableWithConsent=[],noteFor=null,footer=null,typed=true,onlyNamed=null}){
  const[timedOut,setTimedOut]=useState(false);
  const[consentFor,setConsentFor]=useState(/** @type {string|null} */(null));
  const send=timedOut&&onTimedOut?(id)=>{setTimedOut(false);onTimedOut(id);}:onSend;
  const teamInfo=INT_TEAMS[teamKey]||null;
  // The batting order's next name first, marked Next (SCRBRD-100 item 2):
  // the squad's order is the batting order. A suggestion — one tap on any
  // name sends him in (prompts.js batterChoices).
  const available=batterChoices({squad:squad||[],batsmen});
  const getRoleInfo=(name)=>{
    if(!teamInfo)return null;
    return teamInfo.players.find(p=>p.name===name)||null;
  };
  const dismissed=batsmen.filter(b=>b.status==="out");
  const typedIn=typed?()=>false:offSide(squad);
  const atCrease=batsmen.filter(b=>b.status==="batting");
  // Retired hurt — "retired, not out" — may come back, on the same line:
  // the fold carries his runs and balls on (SCRBRD-071). Whom, and when, is
  // the Laws' (`resumable`): not a retirement they read as out, and not
  // straight back into the end he has just left.
  const mayResume=timedOut?[]:resumable;
  const mayResumeWithConsent=timedOut?[]:resumableWithConsent;
  const asking=mayResumeWithConsent.find(b=>b.id===consentFor)??null;
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
                  <span style={{flex:1,minWidth:0,display:"grid",gap:"2px"}}>
                    <span style={{fontFamily:D.body,fontSize:"13px",fontWeight:500,color:D.textPrimary}}>{b.name}</span>
                    {typedIn(b.id)&&<OffSideMark/>}
                  </span>
                  {ri&&<Badge color={ROLE_COLORS[ri.role]}>{ri.role}</Badge>}
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
            {timedOut?"Timed out — tap the batter who did not arrive in time":"Incoming batter timed out?"}
          </button>
        )}
        {mayResume.length>0&&(
          <div data-testid="resume-list" style={{marginBottom:"12px"}}>
            <Lbl sx={{marginBottom:"7px"}}>Retired hurt — may resume</Lbl>
            {mayResume.map(b=>(
              <button key={b.id} type="button" data-testid={`resume-${b.id}`} onClick={()=>send(b.id)} className="pressBtn" style={{
                display:"flex",alignItems:"center",gap:"10px",minHeight:"44px",width:"100%",marginBottom:"4px",
                padding:"8px 12px",borderRadius:D.md,cursor:"pointer",textAlign:"left",
                border:`1px solid ${D.border}`,background:D.surf2}}>
                <span style={{fontFamily:D.body,fontSize:"13px",fontWeight:500,color:D.textPrimary,flex:1}}>{b.name} resumes</span>
                <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textSecondary}}>{b.runs}({b.balls})</span>
              </button>
            ))}
          </div>
        )}
        {mayResumeWithConsent.length>0&&(
          <div data-testid="consent-list" style={{marginBottom:"12px"}}>
            <Lbl sx={{marginBottom:"7px"}}>Retired out — may resume if the opposing captain agrees</Lbl>
            {mayResumeWithConsent.map(b=>(
              <button key={b.id} type="button" data-testid={`consent-${b.id}`} aria-pressed={consentFor===b.id}
                onClick={()=>setConsentFor(v=>v===b.id?null:b.id)} className="pressBtn" style={{
                display:"flex",alignItems:"center",gap:"10px",minHeight:"44px",width:"100%",marginBottom:"4px",
                padding:"8px 12px",borderRadius:D.md,cursor:"pointer",textAlign:"left",
                border:`${consentFor===b.id?2:1}px solid ${consentFor===b.id?T.content.primary:D.border}`,background:D.surf2}}>
                <span style={{fontFamily:D.body,fontSize:"13px",fontWeight:500,color:D.textPrimary,flex:1}}>{b.name} resumes</span>
                <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textSecondary}}>{b.runs}({b.balls})</span>
              </button>
            ))}
            {asking&&(
              <div data-testid="consent-confirm-panel" role="group" aria-label="The opposing captain's consent" style={{
                marginTop:"8px",padding:"12px",borderRadius:D.md,border:`1px solid ${T.content.primary}`,background:T.surface.base}}>
                <p style={{fontFamily:D.body,fontSize:"13px",lineHeight:1.45,color:D.textPrimary,margin:"0 0 10px"}}>
                  {asking.name} retired out. He may come back only if the opposing captain agrees. His wicket is then taken back and his innings goes on.
                </p>
                <button type="button" data-testid="consent-confirm" onClick={()=>{setConsentFor(null);onSend(asking.id,{captainConsent:true});}}
                  className="pressBtn" style={{width:"100%",minHeight:"48px",marginBottom:"6px",padding:"10px 12px",borderRadius:D.md,cursor:"pointer",
                  border:`1px solid ${T.content.primary}`,background:T.content.primary,color:T.surface.canvas,
                  fontFamily:D.body,fontSize:"14px",fontWeight:600}}>
                  The opposing captain agreed — {asking.name} resumes
                </button>
                <button type="button" data-testid="consent-cancel" onClick={()=>setConsentFor(null)} className="pressBtn" style={{
                  width:"100%",minHeight:"44px",padding:"8px 12px",borderRadius:D.md,cursor:"pointer",
                  border:`1px solid ${D.border}`,background:"transparent",color:D.textSecondary,fontFamily:D.body,fontSize:"13px",fontWeight:500}}>
                  Not agreed
                </button>
              </div>
            )}
          </div>
        )}
        {/* Available */}
        <Lbl sx={{marginBottom:"7px"}}>{timedOut?"Who was timed out?":"Available to Bat"}</Lbl>
        <div style={{display:"flex",flexDirection:"column",gap:"4px",marginBottom:"12px"}}>
          {available.map((p)=>{
            const ri=getRoleInfo(p.name);
            const first=p.next;
            return (
              <button key={p.id} onClick={()=>send(p.id)} className="pressBtn" data-testid="batter-choice" data-next={first||undefined} style={{
                display:"flex",alignItems:"center",gap:"10px",minHeight:"48px",flexShrink:0,
                padding:"9px 12px",borderRadius:D.md,cursor:"pointer",textAlign:"left",width:"100%",
                border:`${first?2:1}px solid ${first?T.content.primary:D.border}`,
                background:first?`${D.emerald}0a`:D.surf2,transition:"all .15s",
              }}>
                <div style={{minWidth:"26px",height:"26px",borderRadius:"50%",flexShrink:0,
                  background:first?`${D.emerald}22`:D.surf3,
                  border:`1px solid ${first?D.emerald+"44":D.border}`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontFamily:D.mono,fontSize:"12px",fontWeight:600,
                  color:first?D.textPrimary:D.textSecondary}}>
                  {p.pos}
                </div>
                <span style={{flex:1,minWidth:0,display:"grid",gap:"2px"}}>
                  <span style={{fontFamily:D.body,fontSize:"15px",fontWeight:first?600:400,
                    color:first?D.textPrimary:D.textSecondary}}>{p.name}</span>
                  {/* A super over (SCRBRD-114 phase 3b, D4): who was out in an earlier one — words, never a refusal. */}
                  {noteFor&&noteFor(p.id)&&<span data-testid="batter-superover-note" style={{fontFamily:T.type.body,fontSize:"12px",fontWeight:600,color:T.semantic.warningText}}>{noteFor(p.id)}</span>}
                </span>
                {ri&&<Badge color={ROLE_COLORS[ri.role]} sx={{fontSize:"12px"}}>{ri.role}</Badge>}
                {first&&<Badge color={D.emerald} sx={{fontSize:"12px",marginLeft:"2px"}}>Next</Badge>}
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
            <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>fielding sub only</span>
          </div>
        )}
        {/* Dismissed */}
        {dismissed.length>0&&(
          <details style={{marginBottom:"12px"}}>
            <summary style={{...T.role.label,color:T.content.tertiary,cursor:"pointer",marginBottom:"7px",minHeight:"44px",display:"flex",alignItems:"center"}}>
              Dismissed ({dismissed.length})
            </summary>
            <div style={{display:"flex",flexDirection:"column",gap:"4px",paddingTop:"6px"}}>
              {dismissed.map(b=>(
                <div key={b.id} style={{display:"flex",alignItems:"center",gap:"10px",padding:"6px 10px",
                  borderRadius:D.md,background:`${D.rose}08`,border:`1px solid ${D.rose}15`}}>
                  <span style={{flex:1,minWidth:0,display:"grid",gap:"2px"}}>
                    <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>{b.name}</span>
                    {typedIn(b.id)&&<OffSideMark/>}
                  </span>
                  <span style={{fontFamily:D.mono,fontSize:"12px",color:D.roseText}}>{b.runs}({b.balls})</span>
                </div>
              ))}
            </div>
          </details>
        )}
        <Sep sx={{marginBottom:"12px"}}/>
        {typed?<CustomBatEntry onSend={send}/>
          :<OffSideEntry line={onlyNamed}><CustomBatEntry onSend={send}/></OffSideEntry>}
        {footer&&<p data-testid="batting-footer" style={{fontFamily:T.type.body,fontSize:"13px",lineHeight:1.4,color:T.content.secondary,margin:"12px 0 0"}}>{footer}</p>}
      </div>
    </Sheet>
  );
}

/**
 * On a named side's end (scorer/side.js): the one line, then the deliberate
 * way out — "Not in the named side?", a confirm that says why it is there,
 * and only then the typed field (`children`). Closed by default; nothing is
 * focused for the scorer.
 */
function OffSideEntry({line,children}){
  const[step,setStep]=useState(0); // 0 closed, 1 asked, 2 open
  const quiet={minHeight:"44px",padding:"8px 12px",borderRadius:D.md,cursor:"pointer",fontFamily:T.type.body,fontSize:"13px",fontWeight:500,
    border:`1px solid ${T.line.normal}`,background:"transparent",color:T.content.secondary};
  return (
    <div data-testid="off-side" style={{display:"grid",gap:"8px"}}>
      {line&&<p data-testid="named-only" style={{fontFamily:T.type.body,fontSize:"13px",lineHeight:1.4,color:T.content.secondary,margin:0}}>{line}</p>}
      {step===0&&<button type="button" data-testid="off-side-open" onClick={()=>setStep(1)} className="pressBtn" style={{...quiet,justifySelf:"start"}}>{OFF_SIDE_ASK}</button>}
      {step===1&&(
        <div data-testid="off-side-confirm-panel" role="group" aria-label={OFF_SIDE_ASK} style={{display:"grid",gap:"8px",padding:"10px 12px",borderRadius:D.md,border:`1px solid ${T.line.normal}`}}>
          <p style={{fontFamily:T.type.body,fontSize:"13px",lineHeight:1.4,color:T.content.primary,margin:0}}>{OFF_SIDE_WHY}</p>
          <div style={{display:"flex",gap:"8px"}}>
            <button type="button" data-testid="off-side-confirm" onClick={()=>setStep(2)} className="pressBtn" style={{...quiet,flex:1,color:T.content.primary,fontWeight:600}}>Type a name in</button>
            <button type="button" data-testid="off-side-cancel" onClick={()=>setStep(0)} className="pressBtn" style={{...quiet,flex:1}}>Cancel</button>
          </div>
        </div>
      )}
      {step===2&&children}
    </div>
  );
}
/** The marker for a player typed in on a named side's end. */
function OffSideMark(){
  return <span data-testid="off-side-mark" style={{fontFamily:T.type.body,fontSize:"12px",fontWeight:600,color:T.semantic.warningText}}>{OFF_SIDE_MARK}</span>;
}

function CustomBatEntry({onSend}){
  const[name,setName]=useState("");
  return (
    <div>
      <Lbl sx={{marginBottom:"7px",color:D.textMuted}}>Or Enter Unlisted Player</Lbl>
      <div style={{display:"flex",gap:"8px"}}>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Player name…" aria-label="Player name"
          style={{flex:1,minHeight:"44px",boxSizing:"border-box",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
            color:D.textPrimary,fontSize:"14px",fontFamily:D.body,fontWeight:500,padding:"10px 14px"}}
          onKeyDown={e=>{if(e.key==="Enter"&&name.trim()){
            // The sheet closes on this keydown and focus goes back to the key that opened it
            // (the Wicket key, after a wicket): the rest of this key press would press it.
            e.preventDefault();onSend(name.trim());}}}/>
        <Btn variant="live" disabled={!name.trim()} onClick={()=>name.trim()&&onSend(name.trim())} sx={{borderRadius:D.md,padding:"10px 18px",minHeight:"44px"}}>Go</Btn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   WICKET SHEET
═══════════════════════════════════════════════════════ */
// `twelfth` ({id, name} or null): the twelfth man the coach named for the
// fielding side (scorer/side.js). A substitute fielder may be someone outside
// the eleven (Law 24), so a typed name stays; the twelfth man, when the pad
// knows him, is offered before it.
/**
 * `extra` (Law 22.9, 21.17): the wicket fell on a wide or a no-ball, whose
 * runs the pad has already asked — {type: "Wd" | "Nb", runs}. The sheet
 * offers only the ways out the Law allows off it, opens on run out, and does
 * not ask the runs again; the rest (who, the end, the fielder) is as for any
 * wicket.
 */
function WicketSheet({batName,striker=null,nonStriker=null,fieldingSquad,edition=3,keeper=null,twelfth=null,extra=null,onClose,onConfirm}){
  const offExtra=extra?dismissalsOffExtra(extra.type):null;
  const[mode,setMode]=useState(offExtra?DISMISSAL.RUN_OUT:DISMISSAL.BOWLED);
  // An obstruction that stopped a catch (4th Edition, from 1 October 2026;
  // SCRBRD-113): no runs count, and the fielding captain chooses whether the
  // non-striker or the incoming batter faces the next ball. The 3rd Edition
  // gave no choice: the incoming batter takes the striker's end, as before.
  const[stopped,setStopped]=useState(false);
  const[faces,setFaces]=useState(null);
  // Not off a wide or a no-ball: nobody is out caught off either.
  const asksCatch=!offExtra&&mode===DISMISSAL.OBSTRUCTING_FIELD&&edition===4&&!!striker&&!!nonStriker;
  const asksFaces=asksCatch&&stopped;
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
  // dismissal with no ball it is, not as a delivery. Handled the ball is not
  // offered: since the 2017 Code it is Obstructing the field (Law 37). The
  // engine still reads it, for old logs and pre-2017 scorecards (Kameel,
  // 2026-09-27).
  const modes=Object.keys(DISMISSAL_LABEL).filter(m=>m!==DISMISSAL.TIMED_OUT&&m!==DISMISSAL.HANDLED_BALL&&(!offExtra||offExtra.has(m)));
  // A run out: who, how many runs were completed first, and — when some
  // were, so the batters have crossed (Law 18) — at which end the wicket was
  // put down (Law 38.4). That end is the one left empty (SCRBRD-069).
  // Off an extra the runs were asked with it: they are the runs completed.
  const[ownRuns,setRuns]=useState(0);
  const runs=offExtra?extra.runs:ownRuns;
  const[end,setEnd]=useState(null);
  const isRunOut=mode===DISMISSAL.RUN_OUT;
  const asksWho=(mode===DISMISSAL.RETIRED_OUT||isRunOut||(offExtra&&mode===DISMISSAL.OBSTRUCTING_FIELD))&&striker&&nonStriker;
  const asksEnd=isRunOut&&runs>0;
  const needsFielder=mode===DISMISSAL.CAUGHT||mode===DISMISSAL.RUN_OUT;
  const isStumped=mode===DISMISSAL.STUMPED;
  // The keeper on the record (SCRBRD-126): a stumping is his, and the
  // server refuses one credited to anyone else while one is recorded. With
  // none recorded, a squad's WK as before.
  const wkName=keeper?.name||(fieldingSquad||[]).find(p=>p.role==="WK")?.name||null;
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
    setStopped(false);setFaces(null);
    if(m===DISMISSAL.STUMPED&&wkName)setFielder(wkName);
  };
  const whoName=who===nonStriker?.id?nonStriker?.name:(striker?.name??batName);
  const pill=(on)=>({flex:1,minHeight:"44px",padding:"10px",borderRadius:D.md,cursor:"pointer",fontFamily:D.body,fontSize:"15px",fontWeight:500,
    border:"1px solid "+(on?D.rose+"55":D.border),background:on?D.rose+"1a":D.surf2,color:on?D.roseText:D.textSecondary});
  return (
    <Sheet title="WICKET!" accent={D.rose} onClose={onClose}>
      <div style={{color:D.textSecondary,fontSize:"13px",fontFamily:D.body,marginBottom:"14px",paddingTop:"4px"}}>
        {asksWho?whoName:batName} is dismissed
      </div>
      {offExtra&&(
        <div data-testid="wicket-off-extra" style={{color:D.textPrimary,fontSize:"13px",fontFamily:D.body,marginBottom:"12px"}}>
          {extra.type==="Wd"
            ?`Off a wide${runs?` (${runs} run${runs!==1?"s":""} taken)`:""}: out only run out, stumped, hit wicket or obstructing the field.`
            :`Off a no ball${runs?` (${runs} run${runs!==1?"s":""} completed)`:""}: out only run out, hit the ball twice or obstructing the field.`}
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px",marginBottom:"14px"}}>
        {modes.map(m=>(
          <button key={m} data-testid={`wicket-mode-${m}`} onClick={()=>handleMode(m)} className="pressBtn" style={{
            minHeight:"48px",padding:"8px",borderRadius:D.md,cursor:"pointer",fontFamily:D.body,fontSize:"15px",fontWeight:500,
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
            <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginTop:"6px"}}>
              Recorded between deliveries: no ball of the over, nothing to the bowler.
            </div>
          )}
        </div>
      )}
      {isRunOut&&!offExtra&&(
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
          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginTop:"6px"}}>
            The batters crossed for the runs; the end where the wicket was broken is the one left empty.
          </div>
        </div>
      )}
      {asksCatch&&(
        <div data-testid="wicket-obstruct-catch" style={{marginBottom:"12px"}}>
          <Lbl sx={{marginBottom:"7px"}}>Did the obstruction stop a catch?</Lbl>
          <div style={{display:"flex",gap:"7px"}}>
            <button data-testid="wicket-catch-no" onClick={()=>{setStopped(false);setFaces(null);}} className="pressBtn" style={pill(!stopped)}>No</button>
            <button data-testid="wicket-catch-yes" onClick={()=>setStopped(true)} className="pressBtn" style={pill(stopped)}>Yes</button>
          </div>
          {stopped&&(
            <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginTop:"6px"}}>
              No runs count. The fielding captain chooses who faces the next ball.
            </div>
          )}
        </div>
      )}
      {asksFaces&&(
        <div data-testid="wicket-faces" style={{marginBottom:"12px"}}>
          <Lbl sx={{marginBottom:"7px"}}>Who faces the next ball?</Lbl>
          <div style={{display:"flex",gap:"7px"}}>
            <button data-testid="wicket-faces-non_striker" onClick={()=>setFaces("non_striker")} className="pressBtn" style={pill(faces==="non_striker")}>{nonStriker.name}</button>
            <button data-testid="wicket-faces-incoming" onClick={()=>setFaces("incoming")} className="pressBtn" style={pill(faces==="incoming")}>The incoming batter</button>
          </div>
        </div>
      )}
      {isStumped&&(
        <div style={{marginBottom:"12px",padding:"10px 13px",borderRadius:D.md,
          background:D.violet+"0e",border:"1px solid "+D.violet+"33"}}>
          <Lbl sx={{marginBottom:"4px",color:D.violetText}}>Wicketkeeper</Lbl>
          <div data-testid="wicket-keeper" style={{fontFamily:D.body,fontSize:"13px",color:D.textPrimary,fontWeight:500}}>
            {wkName||"—"}
            {wkName&&<span style={{color:D.textMuted,fontSize:"12px",marginLeft:"6px"}}>{keeper?"(keeping wicket)":"(auto-assigned)"}</span>}
          </div>
        </div>
      )}
      {needsFielder&&fieldingSquad&&fieldingSquad.length>0&&(
        <div style={{marginBottom:"12px"}}>
          <Lbl sx={{marginBottom:"8px"}}>{mode===DISMISSAL.CAUGHT?"Caught by":"Run out by"}</Lbl>
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
                <Badge color={p.role==="WK"?D.violet:p.role==="ALL"?D.amber:p.role==="BOWL"?D.orange:D.sky}>{p.role}</Badge>
              </button>
            ))}
          </div>
          {twelfth&&(
            <button type="button" data-testid="wicket-twelfth" onClick={()=>setFielder(twelfth.name)} className="pressBtn" style={{
              display:"flex",alignItems:"center",gap:"8px",width:"100%",minHeight:"44px",marginTop:"6px",padding:"8px 12px",borderRadius:D.md,
              border:"1px solid "+(fielder===twelfth.name?D.sky+"55":D.border),
              background:fielder===twelfth.name?D.sky+"12":D.surf2,cursor:"pointer",textAlign:"left"}}>
              <span style={{fontFamily:D.body,fontSize:"13px",color:fielder===twelfth.name?D.sky:D.textPrimary,fontWeight:500,flex:1}}>{twelfth.name}</span>
              <Badge color={D.violet}>12th Man</Badge>
            </button>
          )}
          {!fielder&&<div style={{fontFamily:D.body,fontSize:"12px",color:D.amber,marginTop:"6px"}}>{twelfth?"Or type a substitute's name below:":"Or type name below:"}</div>}
          <input value={!fieldingSquad.find(p=>p.name===fielder)&&fielder!==twelfth?.name&&fielder?fielder:""} 
            onChange={e=>setFielder(e.target.value)} placeholder="Type any name…" aria-label="Fielder not in the squad"
            style={{width:"100%",background:D.surf2,border:"1px solid "+D.border,borderRadius:D.md,marginTop:"6px",
              color:D.textPrimary,fontSize:"13px",fontFamily:D.body,padding:"9px 13px"}}/>
        </div>
      )}
      {needsFielder&&(!fieldingSquad||!fieldingSquad.length)&&(
        <div style={{marginBottom:"12px"}}>
          <Lbl sx={{marginBottom:"7px"}}>{mode===DISMISSAL.CAUGHT?"Caught by":"Run out by"}</Lbl>
          <input value={fielder} onChange={e=>setFielder(e.target.value)} placeholder="Fielder name (optional)" aria-label="Fielder name, optional"
            style={{width:"100%",background:D.surf2,border:"1px solid "+D.border,borderRadius:D.md,
              color:D.textPrimary,fontSize:"13px",fontFamily:D.body,padding:"11px 14px"}}/>
        </div>
      )}
      <div style={{display:"flex",gap:"10px",marginTop:"4px"}}>
        <Btn variant="ghost" sx={{flex:1,minHeight:"48px",fontSize:"15px",borderRadius:D.md}} onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" sx={{flex:2,minHeight:"48px",fontSize:"16px",borderRadius:D.md}} data-testid="wicket-confirm" disabled={(asksEnd&&!end)||(asksFaces&&!faces)}
          onClick={()=>{if(asksEnd&&!end)return;if(asksFaces&&!faces)return;onConfirm(mode,displayFielder,{dismissed:asksWho&&who!==striker?.id?who:null,
            runs:isRunOut?runs:0,outAt:asksEnd?end:null,facesNext:asksFaces?faces:null});}}>Confirm Out</Btn>
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════
   NEW OVER / BOWLER SHEET
═══════════════════════════════════════════════════════ */
/**
 * `midOver` (SCRBRD-080): the over is under way, so this is a bowler taking
 * over from one who cannot finish it. Law 17.7.1 allows that only for an
 * injured or suspended bowler, so the sheet asks which before it offers
 * anyone, and passes it on: onConfirm(id, reason).
 */
function NewOverSheet({ovNum,inn=null,prevBowlers,bowlingSquad,bowlingTeamKey,lastBowlerName,refuses,why=null,onSuspended=null,onClose,onConfirm:confirm,midOver=false,capWordsFor=null,
  keeper=null,keeperChoices=[],onKeeper=null,noteFor=null,footer=null,header=null,typed=true,onlyNamed=null}){
  const[name,setName]=useState("");
  const[filter,setFilter]=useState("");
  const[reason,setReason]=useState(null);
  const onConfirm=(id)=>{if(midOver&&!reason)return;confirm(id,midOver?reason:undefined);};
  const reasonPill=(on)=>({flex:1,minHeight:"44px",padding:"10px",borderRadius:D.md,cursor:"pointer",fontFamily:T.type.body,fontSize:"15px",fontWeight:600,
    border:`1px solid ${on?D.amber+"77":T.line.normal}`,background:on?`${D.amber}1a`:T.surface.interactive,color:on?D.amber:T.content.secondary});
  const teamInfo=INT_TEAMS[bowlingTeamKey]||null;
  // Build full list: team bowlers first, then all-rounders, then others
  // Same normalisation as the batting sheet: a demonstration squad is bare
  // strings, a real one is {id, name} with player UUIDs, and what goes into the
  // event has to be the id either way.
  const allBowlers=teamInfo
    ? teamInfo.players.filter(p=>p.bowl).map(p=>({...p,id:p.id??p.name}))
    : (bowlingSquad||[]).map(n=>({...entry(n),role:"BOWL"}));
  // Can't bowl consecutive overs (Law 17.6). `refuses` is lawsRefusal() —
  // the rule the server applies when the bowler event arrives — asked by the
  // id that will be emitted. The name comparison is kept only for a caller
  // that does not pass it.
  // Mid-over, nobody is offered until the reason is chosen.
  const refusalOf=(id,nm)=>refuses?refuses(id??nm):(nm===lastBowlerName?"consecutive_overs":null);
  const canBowl=(p)=>(!midOver||!!reason)&&!refusalOf(p.id,p.name);
  // One list, the likely bowler first (SCRBRD-100 item 2): the one who bowled
  // the over before last, if the Laws let him bowl this one; the rest of the
  // rotation in the order they first bowled; then those who have not bowled.
  // prompts.js bowlerChoices() orders it; the Laws' own answer marks who
  // cannot bowl, and why, in words. A suggestion: one tap on anyone confirms.
  const choices=bowlerChoices({inn:inn??{bowlers:prevBowlers},roster:allBowlers,midOver,
    refuses:(id)=>refusalOf(id,allBowlers.find(p=>p.id===id)?.name??prevBowlers.find(p=>p.id===id)?.name??id)});
  // A bowler typed in on a named side's end, marked where his figures are.
  const typedIn=typed?()=>false:offSide(bowlingSquad);
  const rows=filter
    ? choices.rows.filter(p=>String(p.name).toLowerCase().includes(filter.toLowerCase()))
    : choices.rows;
  return (
    <Sheet title={midOver?"Change of Bowler":ovNum===0?"Opening Bowler":`Over ${ovNum} Complete`} accent={D.amber} onClose={onClose}>
      <div style={{paddingTop:"8px"}}>
        {header}
        {/* Who is keeping (SCRBRD-126): asked with the opening bowler and at
            each over's start, never in the way of the bowler. A change
            mid-over is the pad menu's "Change keeper". */}
        {!midOver&&<KeeperRow keeper={keeper} choices={keeperChoices} onKeeper={onKeeper}/>}
        {midOver&&(
          <div data-testid="bowler-change-reason" style={{marginBottom:"14px"}}>
            <Lbl sx={{marginBottom:"7px",color:D.amber}}>Injury or suspended?</Lbl>
            <div style={{display:"flex",gap:"7px"}}>
              <button type="button" data-testid="bowler-change-injury" onClick={()=>setReason("injury")} className="pressBtn" style={reasonPill(reason==="injury")}>Injury</button>
              {/* Suspended by the umpires (SCRBRD-094 item 2): the suspension
                  is its own record — he may not bowl again — so the pad's
                  suspension sheet takes it from here when there is one. */}
              <button type="button" data-testid="bowler-change-suspended" onClick={()=>onSuspended?onSuspended():setReason("suspended")} className="pressBtn" style={reasonPill(reason==="suspended")}>Suspended</button>
            </div>
            <div style={{fontFamily:T.type.body,fontSize:"12px",color:T.content.tertiary,marginTop:"6px",lineHeight:1.4}}>
              A bowler may be replaced during an over only when injured or suspended. Whoever finishes the over may not bowl the next.
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
            style={{width:"100%",minHeight:"44px",boxSizing:"border-box",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
              color:D.textPrimary,fontSize:"14px",fontFamily:D.body,padding:"9px 14px"}}
            onFocus={e=>e.target.style.borderColor=D.amber+"66"}
            onBlur={e=>e.target.style.borderColor=D.border}/>
        </div>
        {/* The bowlers, likely first (SCRBRD-100 item 2) */}
        <Lbl sx={{marginBottom:"7px",color:D.textSecondary,fontSize:"12px"}}>
          {teamInfo?`${bowlingTeamKey} — Bowling Options`:bowlingSquad?.length?"Fielding Squad":"New Bowler"}
        </Lbl>
        <div data-testid="bowler-choices" style={{display:"flex",flexDirection:"column",gap:"4px",marginBottom:"14px",maxHeight:"320px",overflowY:"auto"}}>
          {rows.map(p=>{
            const asked=!midOver||!!reason;
            // The Laws batch's words first (they know a suspension), else the generic ones.
            const whyNot=asked&&p.refusal?((why&&why(p.refusal))||unavailableWords(p.refusal)):null;
            const dis=!asked||!!p.refusal;
            const role=p.role??(teamInfo?null:"BOWL");
            const rc=ROLE_COLORS[role]||D.orange;
            return (
              <button key={p.id} data-testid="bowler-choice" data-id={p.id} data-group={p.group} data-likely={p.likely||undefined}
                onClick={()=>!dis&&onConfirm(p.id)} disabled={dis} className="pressBtn" style={{
                display:"flex",alignItems:"center",gap:"10px",minHeight:"48px",flexShrink:0,padding:"8px 12px",
                borderRadius:D.md,cursor:dis?"not-allowed":"pointer",textAlign:"left",width:"100%",
                border:`${p.likely?2:1}px solid ${p.likely?T.content.primary:dis?D.border:p.figures?D.amber+"33":D.border}`,
                background:dis?`${D.surf2}55`:p.figures?`${D.amber}08`:D.surf2,opacity:dis?0.6:1,
              }}>
                <span style={{flex:1,minWidth:0,display:"grid",gap:"2px"}}>
                  <span style={{fontFamily:D.body,fontSize:"15px",fontWeight:p.figures?600:500,
                    color:dis?D.textMuted:D.textPrimary}}>{p.name}</span>
                  {p.figures&&typedIn(p.id)&&<OffSideMark/>}
                  {p.likely&&<span data-testid="bowler-likely" style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:T.content.secondary}}>Likely next · bowled the over before last</span>}
                  {/* A super over (SCRBRD-114 phase 3b, D4): the bowler of an earlier one — words, and he can still be chosen. */}
                  {noteFor&&noteFor(p.id)&&<span data-testid="bowler-superover-note" style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:T.semantic.warningText}}>{noteFor(p.id)}</span>}
                  {whyNot&&<span data-testid="bowler-unavailable" style={{fontFamily:D.body,fontSize:"12px",color:D.roseText}}>{whyNot}</span>}
                  {/* The competition's innings cap (SCRBRD-114): words, and
                      the choice stays open — the umpires decide (D1). */}
                  {capWordsFor&&p.figures&&capWordsFor(p.figures.balls)&&(
                    <span data-testid="bowler-cap" style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:T.content.secondary}}>
                      {capWordsFor(p.figures.balls)}</span>
                  )}
                </span>
                {role&&<Badge color={rc} sx={{fontSize:"12px"}}>{role}</Badge>}
                {p.figures&&(
                  <span style={{textAlign:"right",fontFamily:D.mono,fontSize:"12px",color:D.textSecondary,flexShrink:0}}>
                    {fmtOv(p.figures.balls)}ov {p.figures.runs}r{p.figures.wickets>0?` ${p.figures.wickets}w`:""}
                  </span>
                )}
              </button>
            );
          })}
          {rows.length===0&&(
            <div style={{color:D.textMuted,fontSize:"13px",fontFamily:D.body,padding:"12px",textAlign:"center"}}>
              {filter?`No bowlers match "${filter}"`:typed?"Nobody listed: type a name below.":"Nobody listed."}
            </div>
          )}
        </div>
        {footer&&<p data-testid="bowling-footer" style={{fontFamily:T.type.body,fontSize:"13px",lineHeight:1.4,color:T.content.secondary,margin:"0 0 12px"}}>{footer}</p>}
        {/* Manual entry fallback. On an end whose coach named the side
            (scorer/side.js mayType) it waits behind the deliberate way out:
            a late change or a concussion replacement only. */}
        {(()=>{const field=<>
        <Sep sx={{marginBottom:"12px"}}/>
        <Lbl sx={{marginBottom:"7px",color:D.textMuted}}>Or Type Name</Lbl>
        <div style={{display:"flex",gap:"8px"}}>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Bowler name…" aria-label="Bowler name"
            style={{flex:1,minHeight:"44px",boxSizing:"border-box",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
              color:D.textPrimary,fontSize:"14px",fontFamily:D.body,fontWeight:500,padding:"10px 14px"}}
            onFocus={e=>e.target.style.borderColor=D.amber+"66"} onBlur={e=>e.target.style.borderColor=D.border}
            onKeyDown={e=>{if(e.key==="Enter"&&name.trim()&&canBowl({name:name.trim()}))onConfirm(name.trim());}}/>
          <Btn variant="amber" disabled={!name.trim()||!canBowl({name:name.trim()})} onClick={()=>name.trim()&&canBowl({name:name.trim()})&&onConfirm(name.trim())} sx={{borderRadius:D.md,padding:"10px 18px",minHeight:"44px"}}>Go</Btn>
        </div>
        </>;
        return typed?field:<OffSideEntry line={onlyNamed}>{field}</OffSideEntry>;})()}
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
function Innings2Sheet({target,teamName,overs,declared=null,note=null,rain=false,propose=null,why="offline",onClose,onStart,title="Innings Break",startLabel="Start 2nd Innings →",lead=null}){
  const[profile,setProfile]=useState(declared);
  // ── SCRBRD-130 R1: the umpires' figures for the chase (design §1, §2.2) ──
  // After rain cut the first innings, or when the interval was lost, the
  // umpires announce the chase's overs and target; the scorer types them here
  // and the chase's innings_start carries them. Open at once after a
  // rain-affected first innings; otherwise one tap away.
  // A super over's chase (SCRBRD-114 3b) arrives with a lead line; its target
  // is never revised (super_over_no_revision), so the umpires' option is not offered.
  const superOver=lead!=null;
  const[umpires,setUmpires]=useState(rain&&lead==null);
  const[ov,setOv]=useState(String(overs));
  const[tg,setTg]=useState(String(target));
  const ovN=/^\s*\d{1,3}\s*$/.test(ov)?parseInt(ov,10):null, tgN=/^\s*\d{1,4}\s*$/.test(tg)?parseInt(tg,10):null;
  const figuresOk=!umpires||(ovN!=null&&ovN>=1&&tgN!=null&&tgN>=1);
  const shownTarget=umpires&&tgN!=null?tgN:target, shownOvers=umpires&&ovN!=null?ovN:overs;
  // SCRBRD-130 R2: the server's calculator for the chase's overs as typed,
  // beside the umpires' target; asked only once the figures are open.
  const proposal=useProposal(umpires?propose:undefined,umpires&&ovN!=null&&ovN>=1?`chaseOvers=${ovN}`:null,why);
  const rainField={width:"100%",minHeight:"48px",boxSizing:"border-box",padding:"0 14px",borderRadius:D.md,background:D.surf2,
    border:`1px solid ${D.border}`,fontFamily:D.mono,fontSize:"18px",color:D.textPrimary};
  return (
    <Sheet title={title} accent={D.indigo} onClose={onClose}>
      <div style={{textAlign:"center",padding:"20px 0 24px"}}>
        {/* A super over's chase says which it is (SCRBRD-114 phase 3b). */}
        {lead&&<div data-testid="innings2-lead" style={{fontFamily:T.type.body,fontSize:"15px",lineHeight:1.4,color:T.content.primary,margin:"0 0 12px"}}>{lead}</div>}
        <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted,marginBottom:"8px"}}>{teamName} need</div>
        <div data-testid="innings2-target" style={{fontFamily:D.mono,fontSize:"clamp(56px,12vw,80px)",fontWeight:500,
          background:D.grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",
          lineHeight:1,letterSpacing:"-0.02em",marginBottom:"6px"}}>{shownTarget}</div>
        <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted,marginBottom:note?"12px":"24px"}}>runs to win in {shownOvers} {shownOvers===1?"over":"overs"}</div>
        <div style={{textAlign:"left",maxWidth:"360px",margin:"0 auto 16px"}}>
          {!umpires&&!superOver&&(
            <button type="button" data-testid="innings2-umpires-open" onClick={()=>setUmpires(true)} className="pressBtn"
              style={{minHeight:"44px",padding:"0 14px",borderRadius:D.md,cursor:"pointer",border:`1px solid ${D.border}`,
                background:D.surf2,color:D.textPrimary,fontFamily:D.body,fontSize:"14px",fontWeight:600}}>
              Rain: the umpires set the chase
            </button>
          )}
          {umpires&&(
            <div data-testid="innings2-umpires" style={{display:"grid",gap:"10px"}}>
              <div style={{fontFamily:T.type.body,fontSize:"14px",color:T.content.secondary,lineHeight:1.4}}>
                The umpires' figures for the chase, as they announce them.
              </div>
              <label style={{display:"grid",gap:"6px"}}>
                <Lbl>Overs</Lbl>
                <input data-testid="innings2-overs" inputMode="numeric" value={ov} onChange={e=>setOv(e.target.value)} style={rainField}/>
              </label>
              <label style={{display:"grid",gap:"6px"}}>
                <Lbl>Target</Lbl>
                <input data-testid="innings2-target-input" inputMode="numeric" value={tg} onChange={e=>setTg(e.target.value)} style={rainField}/>
              </label>
              <Proposal proposal={proposal} typed={tgN}/>
            </div>
          )}
        </div>
        {/* ── end SCRBRD-130 R1 ── */}
        {/* Five penalty runs awarded to this side while it fielded, before it
            had batted: its innings opens on them (SCRBRD-094). */}
        {note&&<div data-testid="innings2-penalty-note" style={{fontFamily:T.type.body,fontSize:"15px",lineHeight:1.4,color:T.content.primary,marginBottom:"20px"}}>{note}</div>}
        <div style={{textAlign:"left",maxWidth:"360px",margin:"0 auto 20px"}}>
          <CaptureProfilePicker value={profile} onChange={setProfile}/>
        </div>
        <Btn variant="primary" size="lg" disabled={!figuresOk} sx={{borderRadius:D.md,minWidth:"220px"}} data-testid="innings2-start"
          onClick={()=>figuresOk&&onStart(profile,umpires?{overs:ovN,target:tgN}:null)}>{startLabel}</Btn>
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

function InningsReviewSheet({inn,inningsNo,label=null,onConfirm,onFixLastBall,onClose}){
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
    <Sheet title={`${label??`Innings ${inningsNo}`} — check before closing`} accent={D.amber} onClose={onClose}>
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
          <Btn variant="ghost" size="md" sx={{borderRadius:D.md,minHeight:"44px"}}
            onClick={onFixLastBall} data-testid="review-fix">
            Take back the last ball
          </Btn>
        </div>
        <div style={{fontFamily:T.type.body,fontSize:"12px",color:T.content.tertiary,textAlign:"center",marginTop:"10px",lineHeight:1.4}}>
          Once closed, changing this innings needs a correction the scorer cannot approve alone.
        </div>
      </div>
    </Sheet>
  );
}

export { BattingOrderSheet, CustomBatEntry, HandoverSheet, Innings2Sheet, InningsReviewSheet, NewOverSheet, NoBallSheet, RevisionSheet, ShotSelectorSheet, WicketSheet };
