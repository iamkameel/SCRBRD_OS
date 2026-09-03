import { useState, useEffect, useRef, useMemo } from "react";
import {
  deriveInnings, inningsStart, batters as battersEvent, bowler as bowlerEvent,
  ball as ballEvent, penalty as penaltyEvent, inningsEnd,
  newEventId, undoLast,
} from "@scrbrd/scoring";
import { D } from "../design/tokens.js";
import { deviceId } from "../lib/device.js";
import { loadMatch, saveMatch, storageKind } from "../lib/persist.js";
import { profile } from "../lib/session.js";
import { startSync } from "../lib/sync.js";
import { SEGS } from "./field.js";
import { fmtOv } from "./format.js";
import { ALL_SHOTS } from "./shots.js";
import { AnalysisDashboard, ManhattanChart } from "./charts.jsx";
import { DynamicBar, EventOverlay, FreeHitBanner, PartnershipCard, ScorecardPanel, buildEventCfg, detectMilestone } from "./panels.jsx";
import { FocusPad, ScoringPanel } from "./scoring.jsx";
import { SetupScreen } from "./setup.jsx";
import { BattingOrderSheet, Innings2Sheet, NewOverSheet, NoBallSheet, PenaltySheet, ShotSelectorSheet, WicketSheet } from "./sheets.jsx";
import { INT_TEAMS } from "./teams.js";
import { BallDot, Btn, Card, GS, Glass, Lbl } from "./ui.jsx";

// Reconstruct an event log from a seeded innings object.
//
// The demo seeder (seed.js) still builds innings objects directly — it is the
// stand-in for the production replay and is meant to be deleted when the real
// event stream lands. Until then, resuming a seeded match converts its ball
// log back into events so the live scorer runs on one representation only.
// Batter and bowler changes are inferred from each ball's stamped striker and
// bowler, which is exactly the information a delivery record carries.
function eventsFromInnings(i){
  if(!i) return [];
  const ctx={ flagFor: k => INT_TEAMS[k]?.flag };
  const evs=[inningsStart({battingTeam:i.battingTeam,bowlingTeam:i.bowlingTeam,
    squad:i.squad,bowlingSquad:i.bowlingSquad,twelfthMan:i.twelfthMan,
    teamKey:i.teamKey,bowlingTeamKey:i.bowlingTeamKey,overs:i.overs??20})];

  // The openers are the first two batters the seeded innings recorded. Both
  // ends must be named: the scorer refuses to accept a delivery unless it
  // knows the striker AND the non-striker, so losing one here makes the first
  // tap open the batting-order sheet instead of scoring.
  const openers=(i.batsmen||[]).slice(0,2).map(b=>b.id).filter(Boolean);
  if(openers.length===2) evs.push(battersEvent({striker:openers[0],nonStriker:openers[1]}));

  for(const b of (i.ballLog||[])){
    // Ask the replay who is on strike rather than tracking it here — strike
    // rotation is its rule, and a second copy of that rule is exactly the
    // duplication this whole refactor removed. The repeated fold is O(n²) over
    // one innings, which is nothing for ~120 deliveries and runs once, on resume.
    const st=deriveInnings(evs, ctx);
    const s=b.strikerId??b.striker??null, bw=b.bowlerId??b.bowler??null;
    // A striker who is neither of the current pair is a new arrival.
    if(s&&s!==st.striker&&s!==st.nonStriker) evs.push(battersEvent({striker:s}));
    // Replay clears the bowler at the end of each over, so this re-announces
    // them exactly when a real over change would.
    if(bw&&bw!==st.bowler) evs.push(bowlerEvent({bowler:bw}));
    evs.push(ballEvent({type:b.type,value:b.value,shot:b.shot,seg:b.seg,zone:b.zone,
      bowlerApproach:b.bowlerApproach,dismissal:b.dismissal,fielder:b.fielder}));
  }
  return evs;
}

/**
 * Has this over left the phone yet?
 *
 * The single most useful thing a scorer can know, and the artifact showed none
 * of it. It matters most at the two moments where being wrong is expensive:
 * before handing the phone to someone else (a handover with unsynced balls is
 * refused, and the scorer should understand why), and at the end of a match on
 * a ground with no signal, where walking away is how an innings is lost.
 *
 * "Saved" and "sent" are deliberately different words. Saved means the log is
 * on this device and a reload will not lose it. Sent means the rest of the
 * school can see it. A scorer offline all afternoon is fully saved and not at
 * all sent, and telling them "saved" alone would be true and misleading.
 */
function SyncPill({ sync, storage }) {
  const S = {
    synced:  { dot: D.emerald, label: "Sent",   title: "Every ball is on the server" },
    syncing: { dot: D.amber, label: `Sending ${sync.pending}`, title: "Balls still on their way" },
    waiting: { dot: D.amber, label: `Held ${sync.pending}`, title: "No connection — balls are saved and will send when there is one" },
    local:   { dot: D.textMuted, label: "On device", title: `Saved here only (${sync.reason ?? "no server"})` },
    offline: { dot: D.textMuted, label: "On device", title: "Saved here only" },
  }[sync.state] ?? { dot: D.textMuted, label: "On device", title: "Saved here only" };

  return (
    <div title={`${S.title}${storage ? ` · ${storage}` : ""}`}
      aria-label={`Sync status: ${S.label}. ${S.title}`}
      style={{display:"flex",alignItems:"center",gap:"6px",background:D.surf1,
        border:`1px solid ${D.border}`,borderRadius:D.pill,padding:"4px 11px",flexShrink:0}}>
      <div style={{width:"6px",height:"6px",borderRadius:"50%",background:S.dot}}/>
      <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textSecondary}}>{S.label}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════ */
function SCRBRD({resume}={}){
  const[screen,setScreen]=useState("setup");
  const[match,setMatch]=useState(null);
  // ── The event log is the state ──────────────────────────
  // One log per innings. Everything the UI renders — score, scorecard, wagon
  // wheel, worm, partnerships, fall of wickets — is a fold over these, so
  // there is no second copy of the score to drift out of step with them.
  const[events,setEvents]=useState([[],[]]);
  const[curIn,setCurIn]=useState(0);
  const[modal,setModal]=useState(null);
  const[modalCtx,setModalCtx]=useState({});
  const[activeTab,setActiveTab]=useState("score");
  const[selSeg,setSelSeg]=useState(null);
  // Hub state — replaces modal-based shot/field flow
  const[hubStage,setHubStage]=useState(0);
  const[hubShot,setHubShot]=useState(null);
  const[hubApproach,setHubApproach]=useState(null);
  const[selShot,setSelShot]=useState(null);
  const[scoringCtx,setScoringCtx]=useState(null);
  // Overlay: config object {label,sub,color,...} | null
  const[eventOverlay,setEventOverlay]=useState(null);
  // Milestone queue — show one at a time
  const milestoneQRef=useRef([]);
  const[lastOverDCB,setLastOverDCB]=useState(null);
  // Free hit: true after a height/front-foot no-ball
  const[freeHit,setFreeHit]=useState(false);
  // Undo truncates the event log; there is no snapshot stack to keep.
  // Drag-to-reorder cards
  const[cardOrder,setCardOrder]=useState(["scoring","partnership","commentary"]);
  const cardDragRef=useRef(null);
  const[fieldView,setFieldView]=useState("wagon");
  const[hidden,setHidden]=useState(new Set());
  const scoreKeyRef=useRef(0);
  const [uiMode,setUiMode]=useState("focus"); // focus = one-tap pad · pro = full shot capture
  const [focusQuick,setFocusQuick]=useState(false); // one-tap speed mode inside focus scoring
  // ── Identity of this device, and what the server has seen ──
  // Both are refs rather than state: they are read while appending an event
  // and must never trigger a re-render of the scoring pad mid-tap.
  const deviceIdRef = useRef(deviceId());
  const matchIdRef = useRef(null);
  // Ids the server has acknowledged. Empty means nothing has left the device,
  // which is both the truth and the safe answer: undo then truncates, and no
  // correction is written for a ball nobody else has seen.
  const syncedRef = useRef(new Set());
  // The outbox, once the match has been claimed. Null while offline-only —
  // scoring never depends on it existing.
  const syncRef = useRef(null);
  const [sync, setSync] = useState({ state: "offline", pending: 0, reason: null });

  // ── Derivation ──────────────────────────────────────────
  const scoringCtxRef = useRef({ flagFor: k => INT_TEAMS[k]?.flag });
  const innings = useMemo(
    () => events.map(evs => (evs.length ? deriveInnings(evs, scoringCtxRef.current) : null)),
    [events],
  );

  /**
   * Append to the current innings' log. This is the only way state changes.
   *
   * Every event is stamped with an id here, and this is the only place that
   * happens. The id is the event's identity everywhere afterwards: the server
   * dedupes retries on it, and a `void` names its target with it. An event
   * without one cannot be undone once it has left the device, so minting it at
   * the single point of append is what keeps that from being possible.
   */
  const emit = (...evs) => setEvents(prev => {
    const cp = [...prev];
    const stamped = evs.map(e => ({
      ...e,
      innings: curIn,
      id: e.id ?? newEventId(deviceIdRef.current, matchIdRef.current ?? "local"),
    }));
    cp[curIn] = [...cp[curIn], ...stamped];
    // Hand them to the outbox and do NOT wait. The queue writes to disk before
    // it considers a ball recorded, and sends when there is a connection; the
    // board must move on the tap either way. A throw here would be a scoring
    // surface that stops working because the network did.
    if (syncRef.current) {
      for (const ev of stamped) syncRef.current.record(ev).catch(() => {});
    }
    return cp;
  });

  /** What the innings WOULD be with these extra events — used to decide what
   *  happens next (over ended? innings ended?) without duplicating the rules. */
  const project = (...evs) => deriveInnings([...events[curIn], ...evs], scoringCtxRef.current);

  const inn=innings[curIn];

  // ── Durability ──────────────────────────────────────────
  // A phone locks, a battery dies, a browser reloads the tab. On a ground with
  // no signal there is nowhere else the match exists, so the log goes to disk
  // on every change and is rehydrated on return.
  const [matchId, setMatchId] = useState(null);
  const [saveState, setSaveState] = useState({ kind: null, restored: false, savedAt: null });
  const hydratedRef = useRef(false);

  // Resume a live match handed over from the Match Centre. A log already saved
  // on this device WINS over the seeded reconstruction: it is what this scorer
  // actually recorded, and the seed is only a stand-in for a match nobody here
  // has scored yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!resume?.cfg) { hydratedRef.current = true; return; }
      const id = resume.cfg.matchId ?? null;
      setMatch(resume.cfg);
      setMatchId(id);
      matchIdRef.current = id;

      const saved = id ? await loadMatch(id) : null;
      if (cancelled) return;
      if (saved?.events?.some(e => e.length)) {
        setEvents(saved.events);
        setCurIn(saved.curIn ?? 0);
        setSaveState({ kind: await storageKind(), restored: true, savedAt: saved.savedAt ?? null });
      } else {
        setEvents((resume.events ?? (resume.innings || []).map(i => (i ? eventsFromInnings(i) : []))));
        setCurIn(resume.curIn || 0);
        setSaveState({ kind: await storageKind(), restored: false, savedAt: null });
      }
      setScreen("match");
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  // ── The outbox ──────────────────────────────────────────
  // Claim the match and start syncing, once we know which match it is. Every
  // outcome except success is survivable: no signal, not signed in, or a
  // colleague already holding the token all leave the scorer working locally,
  // which is the whole point of the offline design. Refusing to open the pad
  // because sync is unavailable would be exactly the wrong failure.
  useEffect(() => {
    if (!matchId) return;
    let stopped = false;
    let handle = null;
    (async () => {
      const started = await startSync({
        matchId,
        userId: profile()?.user?.id,
        onChange: (st) => {
          if (stopped) return;
          setSync({
            state: st.pendingCount === 0 ? "synced" : (st.online ? "syncing" : "waiting"),
            pending: st.pendingCount,
            reason: st.lastError,
          });
          // The undo boundary reads this: an acknowledged ball can only be
          // taken back with a compensating event.
          syncedRef.current = handle ? handle.syncedIds() : syncedRef.current;
        },
      });
      if (stopped) { started.ok && started.stop(); return; }
      if (!started.ok) { setSync({ state: "local", pending: 0, reason: started.reason }); return; }
      handle = started;
      syncRef.current = started;
      syncedRef.current = started.syncedIds();
      setSync({ state: started.pending() ? "syncing" : "synced", pending: started.pending(), reason: null });
    })();
    return () => {
      stopped = true;
      syncRef.current?.stop();
      syncRef.current = null;
    };
  }, [matchId]);

  // Persist on every change to the log. Skipped until hydration has finished,
  // or the empty initial state would overwrite the very log being restored.
  useEffect(() => {
    if (!hydratedRef.current || !matchId) return;
    if (!events.some(e => e.length)) return;
    let cancelled = false;
    (async () => {
      const ok = await saveMatch(matchId, { events, curIn, cfg: match });
      if (!cancelled && ok) setSaveState(s => ({ ...s, savedAt: Date.now() }));
    })();
    return () => { cancelled = true; };
  }, [events, curIn, matchId]);

  const startMatch=cfg=>{
    setMatch(cfg);
    const sq1=cfg.squad1||[], sq2=cfg.squad2||[];
    const tk1=cfg.teamKey1||cfg.team1, tk2=cfg.teamKey2||cfg.team2;
    const bsq1=INT_TEAMS[tk2]?.players.map(p=>p.name)||sq2;
    const bsq2=INT_TEAMS[tk1]?.players.map(p=>p.name)||sq1;

    // Opening an innings is an event, not an object. Both innings are opened
    // up front so the second already knows its squads when the chase begins.
    const open1=[inningsStart({innings:0,battingTeam:cfg.team1,bowlingTeam:cfg.team2,
      squad:sq1,bowlingSquad:bsq1,twelfthMan:cfg.twelfth1||null,teamKey:tk1,bowlingTeamKey:tk2,overs:cfg.overs||20})];
    const open2=[inningsStart({innings:1,battingTeam:cfg.team2,bowlingTeam:cfg.team1,
      squad:sq2,bowlingSquad:bsq2,twelfthMan:cfg.twelfth2||null,teamKey:tk2,bowlingTeamKey:tk1,overs:cfg.overs||20})];

    // Openers and opening bowler chosen in setup step 4.
    if(cfg.opener1&&cfg.opener2&&cfg.openBowler){
      open1.push(battersEvent({innings:0,striker:cfg.opener1,nonStriker:cfg.opener2}));
      open1.push(bowlerEvent({innings:0,bowler:cfg.openBowler}));
    }
    setEvents([open1,open2]);
    // A match started here has no fixture id yet; mint one so the log is
    // durable from the first ball rather than from whenever it gets an id.
    setMatchId(cfg.matchId ?? `local-${Date.now().toString(36)}`);
    hydratedRef.current = true;
    setCurIn(0);setScreen("match");setModal(null);
  };

  const toggleLine=k=>setHidden(prev=>{const n=new Set(prev);n.has(k)?n.delete(k):n.add(k);return n;});

  // Guard: ensure players are set before scoring
  const guardReady=()=>{
    if(!inn)return false;
    // Only open the opener modal mid-match (e.g. after a wicket where batsman wasn't set)
    // Never re-open at match start — opener + bowler are set during setup
    if(!inn.striker||!inn.nonStriker){setModal("opener");return false;}
    if(!inn.bowler){setModal("bowler");return false;}
    return true;
  };

  // Hub stage 0: approach toggle
  const onApproach=(a)=>setHubApproach(prev=>prev===a?null:a);

  // Hub stage 0: shot selected → advance to field
  const onShot=(shotId)=>{
    if(!guardReady())return;
    setHubShot(shotId);
    setHubStage(1);
    setSelSeg(null);
  };

  // Hub stage 0: skip shot → go straight to field
  const onShotSkip=()=>{
    if(!guardReady())return;
    setHubShot(null);
    setHubStage(1);
    setSelSeg(null);
  };

  // Hub stage 1: field segment selected → advance to runs
  const onFieldSel=(s)=>{
    setSelSeg(s);
    setHubStage(2);
  };

  // Hub stage 2: run value selected → commit
  const onRun=(value)=>{
    if(!inn||!selSeg)return;
    // Hit body → automatically leg-byes (ball didn't hit bat)
    const effectiveType=hubShot==="hit_body"?"LB":"run";
    commitBall(effectiveType,value,hubShot,selSeg.seg,selSeg.zone,hubApproach);
  };

  // Focus-mode commits
  const onRunQuick=(value)=>{
    if(!guardReady())return;
    commitBall("run",value,null,null,null,null);
  };
  // 3-phase commit: type may be run / B (bye) / LB (leg-bye), with shot + area
  const onCommitDetailed=(type,value,shot,seg,zone)=>{
    if(!guardReady())return;
    commitBall(type,value,shot,seg,zone,null);
  };
  // Wicket carrying the shot + area context captured in phases 1–2
  const onWicketCtx=(shot,seg,zone)=>{
    if(!guardReady())return;
    setModalCtx({shot,seg:seg??null,zone:zone??null});
    setModal("wicket");
  };

  const onBye=()=>{
    if(!inn||!selSeg)return;
    commitBall("B",1,hubShot,selSeg.seg,selSeg.zone,hubApproach);
  };

  const onLegBye=()=>{
    if(!inn||!selSeg)return;
    commitBall("LB",1,hubShot,selSeg.seg,selSeg.zone,hubApproach);
  };

  // Hub stage 2: wicket
  const onHubWicket=()=>{
    if(!guardReady())return;
    setModalCtx({shot:hubShot,seg:selSeg?.seg??null,zone:selSeg?.zone??null});
    setModal("wicket");
  };

  // Wide / No Ball — bypass hub entirely
  const onWide=()=>{
    if(!guardReady())return;
    commitBall("Wd",0,null,null,null,hubApproach);
  };

  const onNoBall=()=>{
    if(!guardReady())return;
    setModal("noBall");
  };

  // Reset hub back to stage 0
  const resetHub=()=>{
    setHubStage(0);setHubShot(null);setSelSeg(null);setScoringCtx(null);setSelShot(null);
  };

  // Back one stage in hub
  const onBack=()=>{
    if(hubStage===2){setHubStage(1);setSelSeg(null);}
    else if(hubStage===1){setHubStage(0);setHubShot(null);}
  };

  // Drain milestone queue — called when EventOverlay completes
  const onOverlayDone=()=>{
    const next=milestoneQRef.current.shift();
    if(next)setEventOverlay(next);
    else setEventOverlay(null);
  };
  // Watchdog: whatever happens to the animation timers, no overlay may be
  // left on screen. Bounded slightly above the longest milestone duration.
  useEffect(()=>{
    if(!eventOverlay)return;
    const t=setTimeout(()=>{
      const next=milestoneQRef.current.shift();
      setEventOverlay(next||null);
    },3200);
    return()=>clearTimeout(t);
  },[eventOverlay]);
  // (Blur suppression while a modal is open is handled at render time by
  //  EventOverlay's `suppressBlur` prop — mutating the event object here
  //  used to re-arm its dismiss timers and strand queued overlays.)

  // ── Undo ────────────────────────────────────────────────
  // The artifact kept a deep-copy snapshot stack capped at ten entries,
  // because aggregates could not be recomputed — a scorer who spotted at ball
  // 14 that ball 2 was wrong could not reach it. Re-deriving from the log is
  // exact and has no depth limit.
  //
  // WHICH undo applies depends on whether the server already has the event,
  // and the rule lives in @scrbrd/scoring rather than here: it will apply
  // identically on a second device during a handover, and two implementations
  // of it would be one too many. See packages/scoring/src/undo.mjs.
  const undoLastBall=()=>{
    setEvents(prev=>{
      const cp=[...prev];
      cp[curIn]=undoLast(prev[curIn],{isSynced:e=>syncedRef.current.has(e.id)}).events;
      return cp;
    });
    resetHub();
    setModal(null);
    scoreKeyRef.current++;
  };

  // Legacy onScore kept for any remaining modal references
  const onScore=(type,value)=>{
    if(!inn)return;
    if(!inn.striker||!inn.nonStriker||!inn.bowler){setModal("opener");return;}
    if(type==="Wd"){commitBall("Wd",value,null,null,null,hubApproach);return;}
    if(type==="Nb"){setModal("noBall");return;}
    setScoringCtx({type,value});
  };

  const onShotSelected=(shotId)=>{setSelShot(shotId);setModal(null);if(scoringCtx?.type==="W"){setModalCtx({shot:shotId});setModal("wicket");}};
  const onShotSkipped=()=>{setSelShot(null);setModal(null);if(scoringCtx?.type==="W"){setModalCtx({shot:null});setModal("wicket");}};

  // Called once shot AND field are both known.
  //
  // This used to be sixty lines of parallel bookkeeping: runs, extras, batter
  // figures, bowler figures, partnership, maidens and strike rotation, each
  // updated by hand on every branch. It is now one event. What happens next —
  // did the over end, did the innings end — is read from the projection rather
  // than recomputed here, so the rules live in exactly one place.
  const commitBall=(type,value,shot,seg,zone,approach)=>{
    const ev=ballEvent({type,value,shot,seg,zone,bowlerApproach:approach||null,freeHit});
    const before=inn;
    const after=project(ev);
    const endedOver=after.balls>before.balls&&after.balls%6===0;
    const endedInnings=after.complete;
    const lastBowlerId=before?.bowler||null; // cleared by the projection at over end

    emit(ev);

    setSelSeg(null);setSelShot(null);setScoringCtx(null);setHubStage(0);setHubShot(null);
    scoreKeyRef.current++;
    if(endedOver){
      const ovLog=after.overLog[after.overLog.length-1];
      if(ovLog)setLastOverDCB(ovLog);
    }
    const mile=detectMilestone({...ev,striker:before?.striker,bowler:before?.bowler},before);
    const showBallOverlay=type==="run"&&(value===4||value===6);
    const queue=[];
    if(showBallOverlay)queue.push(buildEventCfg(value,null));
    if(mile)queue.push(buildEventCfg(null,mile));
    // If a modal is about to open (end of over/innings), mark overlays as
    // non-blocking so the blur never covers the sheet underneath.
    const modalPending=endedInnings||endedOver;
    if(queue.length>0){
      const q=modalPending?queue.map(c=>({...c,noBlur:true})):queue;
      milestoneQRef.current=q.slice(1);
      setEventOverlay(q[0]);
    }
    setFreeHit(after.freeHit);
    if(endedInnings){if(curIn===0){setCurIn(1);setModal("innings2");}else setScreen("result");}
    else if(endedOver){setModalCtx({lastBowlerId});setModal("newOver");}
  };

  // After shot selected and field selected — commit the ball
  const commitFromField=(seg,zone)=>{
    if(!scoringCtx)return;
    commitBall(scoringCtx.type,scoringCtx.value,selShot,seg,zone,hubApproach);
  };

  const handleSegSelect=(s)=>{
    setSelSeg(s);
    if(scoringCtx&&scoringCtx.type!=="W"&&scoringCtx.type!=="Wd"&&scoringCtx.type!=="Nb"&&s){
      commitBall(scoringCtx.type,scoringCtx.value,selShot,s.seg,s.zone,hubApproach);
    }
  };

  const confirmWicket=(mode,fielder)=>{
    // The dismissal, the fielder, whose wicket it is and whether the bowler is
    // credited are all decided by the replay. The fielder in particular used to
    // be dropped from the log entirely, so a replayed scorecard could never
    // render "c Botha b Mkhize".
    const ev=ballEvent({type:"W",value:0,shot:modalCtx?.shot||null,
      seg:modalCtx?.seg??null,zone:modalCtx?.zone??null,
      dismissal:mode,fielder:fielder||null,freeHit});
    const before=inn;
    const after=project(ev);
    const endedOver=after.balls>before.balls&&after.balls%6===0;
    const endedInnings=after.complete;
    const stood=after.wickets>before.wickets; // a free hit can save the batter

    emit(ev);

    setSelSeg(null);setSelShot(null);setScoringCtx(null);setModalCtx({});
    scoreKeyRef.current++;setHubStage(0);setHubShot(null);
    {
      // A wicket always opens a follow-up sheet (new batsman / new over /
      // innings break), so every overlay in this chain is non-blocking.
      const wicketCfg={...buildEventCfg("W",null),noBlur:true};
      const mile=detectMilestone({type:"W",value:0,striker:before?.striker,bowler:before?.bowler},before);
      milestoneQRef.current=(mile?[mile]:[]).map(m=>({...buildEventCfg(null,m),noBlur:true}));
      setEventOverlay(wicketCfg);
    }
    setFreeHit(after.freeHit);
    if(endedInnings){if(curIn===0){setCurIn(1);setModal("innings2");}else setScreen("result");}
    else if(!stood){if(endedOver){setModalCtx({lastBowlerId:before?.bowler||null});setModal("newOver");}}
    else if(endedOver)setModal("newBatsmanThenOver");
    else setModal("newBatsman");
  };

  // A batter arriving and a bowler taking the ball are events, not mutations.
  // Without them in the log the log could not stand alone: a delivery record
  // says nothing about who walked in after the last wicket.
  const addBatsman=(name,isStriker)=>{
    const asStriker=isStriker||!inn?.striker;
    emit(battersEvent(asStriker?{striker:name}:{nonStriker:name}));
  };

  const addBowler=name=>emit(bowlerEvent({bowler:name}));

  const awardPenalty=(runs,to,reason)=>{
    emit(penaltyEvent({runs,toBattingTeam:to==="batting",reason}));
    setModal(null);
  };

  const getSquad=()=>{
    if(!inn)return[];
    return inn.squad||[];
  };

  /* ── Modal router ── */
  const renderModal=()=>{
    if(!modal)return null;

    if(modal==="shot")return (
      <ShotSelectorSheet
        onSelect={shot=>{onShotSelected(shot);}}
        onSkip={onShotSkipped}
        onClose={()=>{setScoringCtx(null);setModal(null);}}/>
    );

    if(modal==="noBall")return (
      <NoBallSheet
        onConfirm={(nbType,runs)=>{
          emit(ballEvent({type:"Nb",value:runs,shot:selShot,
            seg:selSeg?.seg??null,zone:selSeg?.zone??null,nbType}));
          setSelSeg(null);setModal(null);scoreKeyRef.current++;
          // A height no-ball or a beamer earns a free hit. The replay also
          // tracks this; setting it here keeps the banner immediate.
          if(nbType==="height"||nbType==="beamer")setFreeHit(true);
        }}
        onClose={()=>setModal(null)}/>
    );

    if(modal==="penalty")return (
      <PenaltySheet
        battingTeam={inn?.battingTeam||"Batting"}
        bowlingTeam={inn?.bowlingTeam||"Bowling"}
        onConfirm={awardPenalty}
        onClose={()=>setModal(null)}/>
    );

    if(modal==="opener")return (
      <BattingOrderSheet
        squad={getSquad()}
        batsmen={inn?.batsmen||[]}
        teamKey={inn?.teamKey}
        twelfthMan={inn?.twelfthMan}
        onSend={name=>{
          const hasStriker=!!(inn?.striker);
          const hasNonStriker=!!(inn?.nonStriker);
          if(!hasStriker){addBatsman(name,true);setModalCtx(p=>({...p,openerCount:(p.openerCount||0)+1}));}
          else if(!hasNonStriker){addBatsman(name,false);setModal("bowler");}
          else{addBatsman(name,true);setModal("bowler");}
        }}
        onClose={()=>setModal(null)}/>
    );

    if(modal==="bowler"){
      const lastBowler=inn?.bowlers.find(b=>b.id===modalCtx?.lastBowlerId);
      return (
        <NewOverSheet
          ovNum={0}
          prevBowlers={inn?.bowlers||[]}
          bowlingSquad={inn?.bowlingSquad||[]}
          bowlingTeamKey={inn?.bowlingTeamKey}
          lastBowlerName={lastBowler?.name||null}
          onClose={()=>setModal(null)}
          onConfirm={name=>{addBowler(name);setModal(null);}}/>
      );
    }

    if(modal==="wicket"){
      // Build fielding squad objects from bowlingTeamKey or bowlingSquad names
      const bowlingTeamKey=inn?.bowlingTeamKey;
      const teamData=INT_TEAMS[bowlingTeamKey];
      const fieldingSquad=teamData
        ?teamData.players.filter((_,i)=>i<11)
        :(inn?.bowlingSquad||[]).map(n=>({name:n,role:"BOWL"}));
      return (
        <WicketSheet
          batName={inn?.batsmen.find(b=>b.id===inn.striker)?.name||"Batsman"}
          fieldingSquad={fieldingSquad}
          onClose={()=>{setModal(null);setScoringCtx(null);setSelShot(null);resetHub();}}
          onConfirm={(mode,fielder)=>{confirmWicket(mode,fielder);}}/>
      );
    }

    if(modal==="newBatsman"||modal==="newBatsmanThenOver"){
      const isThenOver=modal==="newBatsmanThenOver";
      return (
        <BattingOrderSheet
          squad={getSquad()}
          batsmen={inn?.batsmen||[]}
          teamKey={inn?.teamKey}
          twelfthMan={inn?.twelfthMan}
          onSend={name=>{
            addBatsman(name,true);
            if(isThenOver)setModal("newOver");else setModal(null);
          }}
          onClose={()=>setModal(null)}/>
      );
    }

    if(modal==="newOver"){
      const lastBowler=inn?.bowlers.find(b=>b.id===modalCtx?.lastBowlerId);
      return (
        <NewOverSheet
          ovNum={Math.floor((inn?.balls||0)/6)}
          prevBowlers={inn?.bowlers||[]}
          bowlingSquad={inn?.bowlingSquad||[]}
          bowlingTeamKey={inn?.bowlingTeamKey}
          lastBowlerName={lastBowler?.name||null}
          onClose={()=>setModal(null)}
          onConfirm={name=>{addBowler(name);setModal(null);}}/>
      );
    }

    if(modal==="innings2")return (
      <Innings2Sheet
        target={(innings[0]?.runs||0)+1}
        teamName={innings[1]?.battingTeam||""}
        overs={match?.overs||20}
        onClose={()=>setModal(null)}
        onStart={()=>setModal("opener")}/>
    );

    if(modal==="editOrder")return (
      <BattingOrderSheet
        squad={getSquad()}
        batsmen={inn?.batsmen||[]}
        teamKey={inn?.teamKey}
        twelfthMan={inn?.twelfthMan}
        onSend={name=>{addBatsman(name,true);setModal(null);}}
        onClose={()=>setModal(null)}/>
    );

    return null;
  };

  /* ── Result ── */
  if(screen==="result"){
    const i1=innings[0],i2=innings[1];
    const win1=i1&&i2&&i1.runs>i2.runs,tie=i1&&i2&&i1.runs===i2.runs;
    const winner=tie?"Match Tied":win1?i1.battingTeam:i2?.battingTeam;
    const margin=win1?`by ${i1.runs-(i2?.runs||0)} runs`:i2?`by ${10-i2.wickets} wickets`:"";
    return (
      <div style={{minHeight:"100vh",background:D.base,padding:"24px",display:"flex",flexDirection:"column",alignItems:"center"}}>
        <GS/>
        <div style={{width:"100%",maxWidth:"920px"}}>
          <Glass style={{padding:"36px",textAlign:"center",marginBottom:"28px"}}>
            <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:"12px"}}>Match Complete</div>
            <div style={{fontFamily:D.mono,fontSize:"clamp(28px,5vw,48px)",fontWeight:500,background:D.grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",marginBottom:"6px"}}>{winner}</div>
            {!tie&&<div style={{color:D.emerald,fontSize:"16px",fontFamily:D.body,fontWeight:500}}>{margin}</div>}
          </Glass>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"20px",marginBottom:"28px"}}>
            {[0,1].map(ii=>innings[ii]&&<ScorecardPanel key={ii} innings={innings} idx={ii}/>)}
          </div>
          <div style={{textAlign:"center"}}>
            <Btn variant="primary" size="lg" onClick={()=>{setScreen("setup");setEvents([[],[]]);setCurIn(0);setMatch(null);setSelSeg(null);}}>
              New Match
            </Btn>
          </div>
        </div>
      </div>
    );
  }

  if(screen==="setup")return (<><GS/><SetupScreen onStart={startMatch}/></>);

  /* ── MATCH SCREEN ── */
  const NAV=[{id:"score",icon:"🏏",label:"Score"},{id:"cards",icon:"📋",label:"Cards"},{id:"analysis",icon:"📊",label:"Analysis"},{id:"history",icon:"📜",label:"History"}];
  const target2=curIn===1?(innings[0]?.runs||0)+1:null;
  // Determine if shot selection is in progress (show field in "confirm shot" mode)
  const awaitingField=scoringCtx&&scoringCtx.type!=="W"&&scoringCtx.type!=="Wd"&&scoringCtx.type!=="Nb"&&modal===null;

  /* Drag-to-reorder cards in score tab */
  const handleCardDragStart=(e,id)=>{cardDragRef.current=id;e.dataTransfer.effectAllowed="move";};
  const handleCardDragOver=(e,id)=>{
    e.preventDefault();
    if(!cardDragRef.current||cardDragRef.current===id)return;
    const from=cardOrder.indexOf(cardDragRef.current);
    const to=cardOrder.indexOf(id);
    if(from<0||to<0)return;
    const next=[...cardOrder];next.splice(from,1);next.splice(to,0,cardDragRef.current);
    setCardOrder(next);
  };
  const handleCardDrop=()=>{cardDragRef.current=null;};

  return (
    <>
      <GS/>
      {eventOverlay&&<EventOverlay event={eventOverlay} onDone={onOverlayDone} suppressBlur={!!modal}/>}
      {freeHit&&<FreeHitBanner onDismiss={()=>setFreeHit(false)}/>}
      {renderModal()}
      <div style={{minHeight:"100vh",background:D.base,paddingBottom:"88px"}}>
        {/* Top bar */}
        <div style={{position:"sticky",top:0,zIndex:100,background:D.glass,
          backdropFilter:"blur(24px) saturate(1.8)",WebkitBackdropFilter:"blur(24px) saturate(1.8)",
          borderBottom:`1px solid ${D.border}`,padding:"10px 18px",
          display:"flex",alignItems:"center",gap:"12px"}}>
          <div style={{fontFamily:D.head,fontSize:"17px",fontWeight:800,
            background:D.grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",
            letterSpacing:"0.04em",flexShrink:0}}>SCRBRD</div>
          <div style={{width:"1px",height:"16px",background:D.border,flexShrink:0}}/>
          <div style={{flex:1,fontFamily:D.body,fontSize:"13px",fontWeight:500,color:D.textSecondary,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>
            <span style={{marginRight:"3px"}}>{innings[0]?.teamFlag||""}</span>
            <span style={{color:D.sky}}>{match?.team1}</span>
            <span style={{color:D.textMuted,fontSize:"11px"}}> vs </span>
            <span style={{marginRight:"3px"}}>{innings[1]?.teamFlag||""}</span>
            <span style={{color:D.emerald}}>{match?.team2}</span>
            <span style={{color:D.textMuted,fontSize:"11px"}}> · {match?.overs}ov</span>
          </div>
          {/* Awaiting field prompt */}
          {awaitingField&&(
            <div style={{background:`${D.amber}14`,border:`1px solid ${D.amber}44`,borderRadius:D.pill,padding:"4px 12px",
              fontFamily:D.body,fontSize:"11px",fontWeight:500,color:D.amber,flexShrink:0}}>
              {selShot?ALL_SHOTS.find(s=>s.id===selShot)?.label||"Shot selected":"Select field position"}
            </div>
          )}
          {inn&&(
            <div style={{display:"flex",alignItems:"center",gap:"7px",background:D.surf1,
              border:`1px solid ${D.border}`,borderRadius:D.pill,padding:"4px 13px",flexShrink:0}}>
              <div className="liveDot" style={{width:"6px",height:"6px",borderRadius:"50%",background:D.emerald}}/>
              <span style={{fontFamily:D.mono,fontSize:"14px",fontWeight:500,color:D.textPrimary,letterSpacing:"-0.01em"}}>{inn.runs}/{inn.wickets}</span>
              <span style={{color:D.textMuted,fontSize:"11px",fontFamily:D.mono}}>{fmtOv(inn.balls)}</span>
            </div>
          )}
          <SyncPill sync={sync} storage={saveState.kind}/>
        </div>

        {/* Dynamic Content Bar — always visible when match active */}
        {inn&&<DynamicBar inn={inn} match={match} target={target2} isChase={curIn===1} lastOver={lastOverDCB}/>}

        {/* Content */}
        <div style={{maxWidth:"1320px",margin:"0 auto",padding:"16px"}}>
          {activeTab==="score"&&uiMode==="focus"&&(
            <FocusPad inn={inn} match={match} curIn={curIn} target={target2}
              onCommitDetailed={onCommitDetailed} onWicketCtx={onWicketCtx}
              onWide={onWide} onNoBall={onNoBall}
              onUndo={undoLastBall} onPro={()=>setUiMode("pro")}
              quick={focusQuick} onToggleQuick={()=>setFocusQuick(v=>!v)}/>
          )}
          {activeTab==="score"&&uiMode!=="focus"&&(
            <div className="pro-score-grid">
              {/* Left column: fixed scoring panel */}
              <ScoringPanel
                inn={inn} innings={innings} curIn={curIn} match={match}
                hubStage={hubStage} hubShot={hubShot} hubApproach={hubApproach}
                selSeg={selSeg} freeHit={freeHit}
                fieldView={fieldView} setFieldView={setFieldView}
                hidden={hidden} toggleLine={toggleLine}
                setModal={setModal} scoreKey={scoreKeyRef.current}
                onApproach={onApproach} onShot={onShot} onShotSkip={onShotSkip}
                onFieldSel={onFieldSel} onRun={onRun} onBye={onBye} onLegBye={onLegBye}
                onWicket={onHubWicket} onWide={onWide} onNoBall={onNoBall} onReset={resetHub}
                onBack={onBack} onUndo={undoLastBall}/>
              {/* Right column: draggable cards */}
              <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"6px",padding:"2px 0"}}>
                  <Lbl sx={{color:D.textMuted,fontSize:"9px"}}>⠿ drag cards to reorder</Lbl>
                  <button onClick={()=>setUiMode("focus")} className="pressBtn" style={{marginLeft:"auto",padding:"4px 10px",borderRadius:D.pill,background:D.emerald+"14",border:`1px solid ${D.emerald}33`,color:D.emerald,fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",cursor:"pointer"}}>⚡ FOCUS MODE</button>
                </div>
                {cardOrder.map(cardId=>{
                  const dragProps={
                    draggable:true,
                    onDragStart:e=>handleCardDragStart(e,cardId),
                    onDragOver:e=>handleCardDragOver(e,cardId),
                    onDrop:handleCardDrop,
                    style:{cursor:"grab",transition:"opacity .15s"},
                  };
                  if(cardId==="scoring")return (
                    <div key="scoring" {...dragProps}>
                      <ScorecardPanel innings={innings} idx={curIn}/>
                      {curIn===1&&innings[0]&&<div style={{marginTop:"12px"}}><ScorecardPanel innings={innings} idx={0}/></div>}
                    </div>
                  );
                  if(cardId==="partnership")return (
                    <div key="partnership" {...dragProps}>
                      <PartnershipCard inn={inn}/>
                    </div>
                  );
                  if(cardId==="commentary")return (
                    <div key="commentary" {...dragProps}>
                      <ManhattanChart inn={inn} match={match}/>
                    </div>
                  );
                  return null;
                })}
              </div>
            </div>
          )}
          {activeTab==="cards"&&(
            <div className="sc-grid-2">
              <div><Lbl sx={{marginBottom:"10px"}}>1st Innings</Lbl><ScorecardPanel innings={innings} idx={0}/></div>
              <div>
                <Lbl sx={{marginBottom:"10px"}}>2nd Innings</Lbl>
                {innings[1]
                  ?<ScorecardPanel innings={innings} idx={1}/>
                  :<Card style={{padding:"36px",textAlign:"center"}}><span style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>Not started yet</span></Card>
                }
              </div>
            </div>
          )}
          {activeTab==="analysis"&&<AnalysisDashboard inn={inn} match={match} curIn={curIn} innings={innings}/>}
          {activeTab==="history"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
              {/* Commentary log — shows shot type per ball */}
              <Card>
                <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`}}>
                  <Lbl>Ball-by-Ball Commentary</Lbl>
                </div>
                <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:"6px"}}>
                  {[...(inn?.ballLog||[])].reverse().slice(0,30).map((b,i)=>{
                    const shot=b.shot?ALL_SHOTS.find(s=>s.id===b.shot):null;
                    const seg=b.seg!=null?SEGS[b.seg]:null;
                    return (
                      <div key={i} style={{display:"flex",alignItems:"flex-start",gap:"10px",padding:"8px 0",
                        borderBottom:`1px solid ${D.border}`,opacity:1-i*.025}}>
                        <BallDot ball={b} size={24}/>
                        <div style={{flex:1}}>
                          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textPrimary,fontWeight:500}}>
                            {b.type==="W"?"WICKET — "+b.dismissal:
                             b.type==="Wd"?"Wide ball":
                             b.type==="Nb"?`No Ball (${b.nbType?.replace("_"," ")||""}), ${b.value||0}+1 runs`:
                             b.type==="Pen"?`Penalty ${b.value} runs to ${b.to} team — ${b.reason}`:
                             b.type==="B"?`Bye, ${b.value} run${b.value!==1?"s":""}`:
                             b.type==="LB"?`Leg Bye, ${b.value} run${b.value!==1?"s":""}`:
                             `${b.value} run${b.value!==1?"s":""}`}
                          </div>
                          <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginTop:"2px",display:"flex",gap:"8px",flexWrap:"wrap"}}>
                            {shot&&<span style={{color:shot.color}}>🏏 {shot.label}</span>}
                            {seg&&<span>📍 {seg.label}{b.zone==="boundary"?" · Boundary":b.zone==="outer"?" · Outfield":""}</span>}
                            <span style={{color:D.textMuted}}>Over {(b.over||0)+1}.{(b.ballInOver||0)+1}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!inn?.ballLog?.length&&<div style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px",padding:"12px"}}>No balls bowled yet.</div>}
                </div>
              </Card>
              {/* Over cards */}
              <Card>
                <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`}}>
                  <Lbl>Over-by-Over</Lbl>
                </div>
                <div style={{padding:"16px",display:"flex",flexWrap:"wrap",gap:"12px"}}>
                  {(inn?.overLog||[]).map((ov,oi)=>{
                    const ovRuns=ov.balls.reduce((s,b)=>s+(b.value||0),0);
                    const hasWkt=ov.balls.some(b=>b.type==="W");
                    const hasBnd=ov.balls.some(b=>b.value===4||b.value===6);
                    return (
                      <div key={oi} style={{minWidth:"130px",background:D.surf2,borderRadius:D.md,padding:"10px 12px",
                        border:`1px solid ${hasWkt?D.rose+"30":hasBnd?D.indigo+"25":D.border}`}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:"7px",alignItems:"center"}}>
                          <Lbl>Ov {ov.over+1}</Lbl>
                          <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textSecondary}}>{ovRuns}r{hasWkt?" W":""}</span>
                        </div>
                        <div style={{display:"flex",gap:"3px",flexWrap:"wrap"}}>
                          {ov.balls.map((b,bi)=><BallDot key={bi} ball={b} size={22}/>)}
                        </div>
                      </div>
                    );
                  })}
                  {!inn?.overLog?.length&&<div style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>No overs completed.</div>}
                </div>
              </Card>
            </div>
          )}
        </div>

        {/* Stadium Bar */}
        <div style={{position:"fixed",bottom:"20px",left:"50%",transform:"translateX(-50%)",zIndex:150,
          background:D.glass,backdropFilter:"blur(28px) saturate(2)",WebkitBackdropFilter:"blur(28px) saturate(2)",
          border:`1px solid ${D.borderMed}`,borderRadius:D.pill,padding:"6px",display:"flex",gap:"2px",
          boxShadow:"0 20px 60px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08),inset 0 1px 0 rgba(255,255,255,.1)"}}>
          {NAV.map(n=>{
            const active=activeTab===n.id;
            return (
              <button key={n.id} onClick={()=>setActiveTab(n.id)} className="pressBtn" style={{
                display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",
                padding:"9px 22px",borderRadius:D.pill,cursor:"pointer",border:"none",
                background:active?D.grad:"transparent",
                boxShadow:active?"0 4px 20px rgba(79,70,229,.5),0 0 28px rgba(79,70,229,.35)":"none",
                transition:"all .3s cubic-bezier(.34,1.56,.64,1)"}}>
                <span style={{fontSize:"16px",lineHeight:1,filter:active?"none":"grayscale(.6) opacity(.7)"}}>{n.icon}</span>
                <span style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:active?"#fff":D.textMuted}}>{n.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

export { SCRBRD };
