import { useState, useEffect, useRef } from "react";
import { D } from "../design/tokens.js";
import { AnalysisDashboard, ManhattanChart } from "./charts.jsx";
import { DynamicBar, EventOverlay, FreeHitBanner, PartnershipCard, ScorecardPanel, buildEventCfg, detectMilestone } from "./panels.jsx";
import { FocusPad, ScoringPanel } from "./scoring.jsx";
import { SetupScreen } from "./setup.jsx";
import { BattingOrderSheet, Innings2Sheet, NewOverSheet, NoBallSheet, PenaltySheet, ShotSelectorSheet, WicketSheet } from "./sheets.jsx";
import { INT_TEAMS } from "./teams.js";
import { BallDot, Btn, Card, GS, Glass, Lbl } from "./ui.jsx";

const initInn=(bt,bw,squad,twelfthMan,teamKey,bowlingSquad,bowlingTeamKey)=>({
  battingTeam:bt,bowlingTeam:bw,runs:0,wickets:0,balls:0,
  extras:{wide:0,noBall:0,bye:0,legBye:0,penalty:0},
  batsmen:[],bowlers:[],fow:[],ballLog:[],overLog:[],
  partnerships:[], // [{bat1,bat2,runs,balls,startWicket}]
  curPartner:{runs:0,balls:0,bat1:null,bat2:null}, // live partnership
  striker:null,nonStriker:null,bowler:null,complete:false,
  squad:squad||[],
  twelfthMan:twelfthMan||null,
  teamKey:teamKey||bt,
  teamFlag:INT_TEAMS[teamKey]?.flag||"🏏",
  bowlingSquad:bowlingSquad||[],
  bowlingTeamKey:bowlingTeamKey||bw,
});

/* ═══════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════ */
function SCRBRD({resume}={}){
  const[screen,setScreen]=useState("setup");
  const[match,setMatch]=useState(null);
  const[innings,setInnings]=useState([null,null]);
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
  // Undo stack — snapshots of [innings, curIn] before each legal delivery
  const undoStackRef=useRef([]);
  // Drag-to-reorder cards
  const[cardOrder,setCardOrder]=useState(["scoring","partnership","commentary"]);
  const cardDragRef=useRef(null);
  const[fieldView,setFieldView]=useState("wagon");
  const[hidden,setHidden]=useState(new Set());
  const scoreKeyRef=useRef(0);
  const [uiMode,setUiMode]=useState("focus"); // focus = one-tap pad · pro = full shot capture
  const [focusQuick,setFocusQuick]=useState(false); // one-tap speed mode inside focus scoring
  const inn=innings[curIn];

  // Resume a live match handed over from ScrbrdOS Match Centre.
  useEffect(()=>{
    if(resume&&resume.cfg){
      setMatch(resume.cfg);
      setInnings(resume.innings);
      setCurIn(resume.curIn||0);
      setScreen("match");
    }
  },[]);

  const startMatch=cfg=>{
    setMatch(cfg);
    const sq1=cfg.squad1||[], sq2=cfg.squad2||[];
    const tk1=cfg.teamKey1||cfg.team1, tk2=cfg.teamKey2||cfg.team2;
    const bsq1=INT_TEAMS[tk2]?.players.map(p=>p.name)||sq2;
    const bsq2=INT_TEAMS[tk1]?.players.map(p=>p.name)||sq1;
    const inn1=initInn(cfg.team1,cfg.team2,sq1,cfg.twelfth1||null,tk1,bsq1,tk2);
    const inn2=initInn(cfg.team2,cfg.team1,sq2,cfg.twelfth2||null,tk2,bsq2,tk1);
    // Pre-set openers and opening bowler from setup step 4
    if(cfg.opener1&&cfg.opener2&&cfg.openBowler){
      // Striker
      inn1.batsmen=[
        {id:cfg.opener1,name:cfg.opener1,runs:0,balls:0,fours:0,sixes:0,status:"batting",dismissal:null},
        {id:cfg.opener2,name:cfg.opener2,runs:0,balls:0,fours:0,sixes:0,status:"batting",dismissal:null},
      ];
      inn1.striker=cfg.opener1;
      inn1.nonStriker=cfg.opener2;
      // Bowler
      inn1.bowlers=[{id:cfg.openBowler,name:cfg.openBowler,balls:0,runs:0,wickets:0,maidens:0,wides:0,noBalls:0}];
      inn1.bowler=cfg.openBowler;
    }
    setInnings([inn1,inn2]);
    setCurIn(0);setScreen("match");setModal(null); // no opener modal needed
  };

  const updInn=fn=>setInnings(prev=>{
    const cp=[
      prev[0]?{...prev[0],batsmen:[...prev[0].batsmen],bowlers:[...prev[0].bowlers],
        ballLog:[...prev[0].ballLog],overLog:[...prev[0].overLog],
        fow:[...prev[0].fow],extras:{...prev[0].extras}}:null,
      prev[1]?{...prev[1],batsmen:[...prev[1].batsmen],bowlers:[...prev[1].bowlers],
        ballLog:[...prev[1].ballLog],overLog:[...prev[1].overLog],
        fow:[...prev[1].fow],extras:{...prev[1].extras}}:null,
    ];
    fn(cp[curIn]);return cp;
  });

  const rotStrike=i=>{const t=i.striker;i.striker=i.nonStriker;i.nonStriker=t;};

  const logBall=(i,ball)=>{
    i.ballLog=[...i.ballLog,ball];
    const ov=Math.floor(i.balls/6);
    const last=i.overLog.length?i.overLog[i.overLog.length-1]:null;
    if(!last||last.over!==ov)i.overLog=[...i.overLog,{over:ov,balls:[ball]}];
    else{const ol=[...i.overLog];ol[ol.length-1]={...ol[ol.length-1],balls:[...ol[ol.length-1].balls,ball]};i.overLog=ol;}
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

  // Undo — restore previous innings snapshot
  const undoLastBall=()=>{
    const snap=undoStackRef.current.pop();
    if(!snap)return;
    setInnings(snap.innings);
    setCurIn(snap.curIn);
    resetHub();
    setModal(null);
    scoreKeyRef.current++;
  };

  // Snapshot before committing (called at start of commitBall)
  const snapshotForUndo=()=>{
    const snap={
      innings:innings.map(i=>i?{
        ...i,
        batsmen:i.batsmen.map(b=>({...b})),
        bowlers:i.bowlers.map(b=>({...b})),
        ballLog:[...i.ballLog],
        overLog:i.overLog.map(o=>({...o,balls:[...o.balls]})),
        fow:[...i.fow],
        extras:{...i.extras},
        partnerships:[...(i.partnerships||[])],
        curPartner:i.curPartner?{...i.curPartner}:{runs:0,balls:0,bat1:null,bat2:null},
      }:null),
      curIn,
    };
    undoStackRef.current=[...undoStackRef.current.slice(-9),snap]; // keep last 10
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

  // Called once shot AND field are both known
  const commitBall=(type,value,shot,seg,zone,approach)=>{
    snapshotForUndo(); // snapshot BEFORE any state change
    const maxBalls=(match?.overs||20)*6;
    const curBalls=inn.balls;
    const isLegal=type!=="Wd"&&type!=="Nb";
    // Count legal deliveries in the CURRENT over (Wides/No-balls don't count)
    const curOverNum=Math.floor(curBalls/6);
    const curOverLog=inn.overLog.find(o=>o.over===curOverNum);
    const legalInOver=(curOverLog?.balls||[]).filter(b=>b.type!=="Wd"&&b.type!=="Nb").length;
    // Over ends when this legal ball makes 6 legal in the over
    const willEndOver=isLegal&&(legalInOver+1)===6;
    const newBalls=curBalls+(isLegal?1:0);
    const willEndInnings=isLegal&&(newBalls>=maxBalls||inn.wickets>=10);
    const ball={type,value,shot,seg,zone,bowlerApproach:approach||null,over:Math.floor(curBalls/6),ballInOver:curBalls%6,striker:inn?.striker,bowler:inn?.bowler};
    const lastBowlerId=inn?.bowler||null; // captured before updInn zeroes bowler at over-end
    updInn(i=>{
      const bat=i.batsmen.find(b=>b.id===i.striker);
      const bow=i.bowlers.find(b=>b.id===i.bowler);
      if(type==="Wd"){
        const total=1+value;
        i.runs+=total;i.extras.wide+=total;
        if(bow){bow.runs+=total;bow.wides=(bow.wides||0)+1;}
        logBall(i,ball);return;
      }
      if(type==="Nb"){
        // Already handled by NoBall sheet — value includes runs off bat, penalty=1 built in
        const total=1+value; // 1 penalty + runs
        i.runs+=total;i.extras.noBall+=1;i.extras.wide+=0;
        if(bat&&value>0){bat.runs+=value;bat.balls++;if(value===4)bat.fours++;if(value===6)bat.sixes++;}
        if(bow){bow.runs+=total;bow.noBalls=(bow.noBalls||0)+1;}
        logBall(i,ball);
        // No ball doesn't count as legal delivery - no over advancement
        return;
      }
      if(type==="B"){i.runs+=value;i.extras.bye+=value;i.balls++;if(bow)bow.balls++;logBall(i,ball);if(value%2!==0)rotStrike(i);}
      else if(type==="LB"){i.runs+=value;i.extras.legBye+=value;i.balls++;if(bow)bow.balls++;logBall(i,ball);if(value%2!==0)rotStrike(i);}
      else{
        i.runs+=value;i.balls++;
        if(bat){bat.runs+=value;bat.balls++;if(value===4)bat.fours++;if(value===6)bat.sixes++;}
        if(bow){bow.runs+=value;bow.balls++;}
        logBall(i,ball);
        if(value%2!==0)rotStrike(i);
      }
      // Partnership tracking — update live partnership on every legal delivery
      if(type!=="Wd"&&type!=="Nb"){
        if(!i.curPartner)i.curPartner={runs:0,balls:0,bat1:null,bat2:null};
        i.curPartner.runs+=(value||0);
        i.curPartner.balls+=1;
        if(!i.curPartner.bat1)i.curPartner.bat1=i.striker;
        if(!i.curPartner.bat2)i.curPartner.bat2=i.nonStriker;
      }
      // Check maiden: end of over, 0 runs from bowler this over
      if(willEndOver){
        const ovBalls=i.ballLog.filter(b=>b.over===Math.floor(curBalls/6));
        const ovBowlerRuns=ovBalls.reduce((s,b)=>s+(b.type==="run"||b.type==="W"?0:(b.value||0)),0);
        if(bow&&ovBowlerRuns===0&&ovBalls.filter(b=>b.type==="run"||b.type==="W"||b.type==="B"||b.type==="LB").every(b=>(b.value||0)===0))bow.maidens++;
        rotStrike(i);i.bowler=null;
      }
      if(i.balls>=maxBalls||i.wickets>=10)i.complete=true;
    });
    setSelSeg(null);setSelShot(null);setScoringCtx(null);setHubStage(0);setHubShot(null);
    scoreKeyRef.current++;
    // Track completed over for DCB
    if(willEndOver){
      const ovNum=Math.floor(inn.balls/6);
      const ovLog=inn.overLog.find(o=>o.over===ovNum);
      if(ovLog)setLastOverDCB(ovLog);
    }
    const mile=detectMilestone(ball,inn);
    const showBallOverlay=type==="run"&&(value===4||value===6);
    const queue=[];
    if(showBallOverlay)queue.push(buildEventCfg(value,null));
    if(mile)queue.push(buildEventCfg(null,mile));
    // If a modal is about to open (end of over/innings), mark overlays as non-blocking
    // so the blur never covers the modal sheet underneath
    const modalPending=willEndInnings||willEndOver;
    if(queue.length>0){
      const q=modalPending?queue.map(c=>({...c,noBlur:true})):queue;
      milestoneQRef.current=q.slice(1);
      setEventOverlay(q[0]);
    }
    // Clear free-hit after this delivery
    if(freeHit)setFreeHit(false);
    if(willEndInnings){if(curIn===0){setCurIn(1);setModal("innings2");}else setScreen("result");}
    else if(willEndOver){setModalCtx({lastBowlerId});setModal("newOver");}
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
    snapshotForUndo();
    const shot=modalCtx?.shot||null;
    const seg=modalCtx?.seg??null;const zone=modalCtx?.zone??null;
    const maxBalls=(match?.overs||20)*6;
    const cb=inn.balls,nw=(inn.wickets||0)+1;
    const newBalls=cb+1;
    const willEndOver=newBalls>0&&newBalls%6===0;
    const willEndInnings=newBalls>=maxBalls||nw>=10;
    updInn(i=>{
      const bat=i.batsmen.find(b=>b.id===i.striker);
      const bow=i.bowlers.find(b=>b.id===i.bowler);
      if(bat){bat.status="out";bat.dismissal=`${mode}${fielder?` - ${fielder}`:""}${bow?` b. ${bow.name}`:""}`; bat.balls++;}
      if(bow){bow.wickets++;bow.balls++;}
      i.wickets++;i.balls++;
      i.fow=[...i.fow,{runs:i.runs,wickets:i.wickets,batsman:bat?.name||"?",overs:fmtOv(i.balls)}];
      const ball={type:"W",value:0,shot,seg,zone,over:Math.floor(cb/6),ballInOver:cb%6,striker:i.striker,bowler:i.bowler,dismissal:mode};
      logBall(i,ball);
      // Close current partnership
      if(!i.partnerships)i.partnerships=[];
      if(i.curPartner&&(i.curPartner.runs>0||i.curPartner.balls>0)){
        const cp=i.curPartner;
        const b1=i.batsmen.find(b=>b.id===cp.bat1);
        const b2=i.batsmen.find(b=>b.id===cp.bat2);
        i.partnerships=[...i.partnerships,{
          bat1:b1?.name||"?",bat2:b2?.name||"?",
          runs:cp.runs,balls:cp.balls,wicket:i.wickets
        }];
      }
      i.curPartner={runs:0,balls:0,bat1:null,bat2:null};
      i.striker=null;
      if(willEndOver)i.bowler=null;
      if(i.balls>=maxBalls||i.wickets>=10)i.complete=true;
    });
    setSelSeg(null);setSelShot(null);setScoringCtx(null);setModalCtx({});scoreKeyRef.current++;setHubStage(0);setHubShot(null);
    {// Wicket overlay + milestone check.
     // A wicket always opens a follow-up sheet (new batsman / new over /
     // innings break), so every overlay in this chain is non-blocking.
      const wicketCfg={...buildEventCfg("W",null),noBlur:true};
      const mile=detectMilestone({type:"W",value:0,striker:inn?.striker,bowler:inn?.bowler},inn);
      const queue=mile?[mile]:[];
      milestoneQRef.current=queue.map(m=>({...buildEventCfg(null,m),noBlur:true}));
      setEventOverlay(wicketCfg);
    }
    if(willEndInnings){if(curIn===0){setCurIn(1);setModal("innings2");}else setScreen("result");}
    else if(willEndOver)setModal("newBatsmanThenOver");
    else setModal("newBatsman");
  };

  const addBatsman=(name,isStriker)=>{
    updInn(i=>{
      let existing=i.batsmen.find(b=>b.name===name);
      if(!existing){
        const id=Date.now()+Math.random();
        const teamInfo=INT_TEAMS[i.teamKey];
        const pInfo=teamInfo?.players.find(p=>p.name===name);
        existing={id,name,runs:0,balls:0,fours:0,sixes:0,status:"batting",dismissal:null,batHand:pInfo?.batHand||"R"};
        i.batsmen=[...i.batsmen,existing];
      } else {existing.status="batting";}
      if(isStriker||i.striker===null)i.striker=existing.id;else i.nonStriker=existing.id;
    });
  };

  const addBowler=name=>{
    updInn(i=>{
      let bow=i.bowlers.find(b=>b.name.toLowerCase()===name.toLowerCase());
      if(!bow){
        const id=Date.now()+Math.random();
        const bTeam=INT_TEAMS[i.bowlingTeamKey];
        const pInfo=bTeam?.players.find(p=>p.name===name);
        bow={id,name,balls:0,maidens:0,runs:0,wickets:0,wides:0,noBalls:0,bowlArm:pInfo?.bowlArm||"R",bowlStyle:pInfo?.bowlStyle||"F"};
        i.bowlers=[...i.bowlers,bow];i.bowler=id;
      } else i.bowler=bow.id;
    });
  };

  const awardPenalty=(runs,to,reason)=>{
    updInn(i=>{
      if(to==="batting"){i.runs+=runs;i.extras.penalty=(i.extras.penalty||0)+runs;}
      // If bowling team awarded penalty, it's weird but track it
      const ball={type:"Pen",value:runs,to,reason,over:Math.floor(i.balls/6),ballInOver:i.balls%6};
      i.ballLog=[...i.ballLog,ball];
    });
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
          const ball={type:"Nb",value:runs,nbType,shot:selShot,seg:selSeg?.seg??null,zone:selSeg?.zone??null,
            over:Math.floor((inn?.balls||0)/6),ballInOver:(inn?.balls||0)%6,striker:inn?.striker,bowler:inn?.bowler};
          const total=1+runs;
          updInn(i=>{
            const bat=i.batsmen.find(b=>b.id===i.striker);
            const bow=i.bowlers.find(b=>b.id===i.bowler);
            i.runs+=total;i.extras.noBall+=1;
            if(bat&&runs>0){bat.runs+=runs;bat.balls++;if(runs===4)bat.fours++;if(runs===6)bat.sixes++;}
            if(bow){bow.runs+=total;bow.noBalls=(bow.noBalls||0)+1;}
            logBall(i,ball);
          });
          setSelSeg(null);setModal(null);scoreKeyRef.current++;
          // Free hit on height no-ball and beamer
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
            <Btn variant="primary" size="lg" onClick={()=>{setScreen("setup");setInnings([null,null]);setCurIn(0);setMatch(null);setSelSeg(null);}}>
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

export { SCRBRD, initInn };
