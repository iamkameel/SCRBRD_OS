import { SEGS } from "./field.js";
import { INT_TEAMS } from "./teams.js";
import { fmtOv } from "./format.js";

// The mutable innings object the seeder builds into.
//
// This is the LAST place in the app that constructs an innings rather than
// deriving one, and it lives here deliberately: the seeder is the demo-mode
// stand-in for the production event stream, and the source comment has always
// said it should be deleted when the real replay lands — not adapted. The live
// scorer no longer uses it.
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

// ── Innings state seeder ───────────────────────────────
// Reconstructs a complete, internally consistent innings (ball log,
// over log, partnerships, FOW, extras, bowler figures, strike) from a
// score summary, deterministic per match id. Demo-mode stand-in for
// the production LIVE_SCORE_BUS event-sourced replay.
function seedRng(key){
  let s=2166136261; for(let i=0;i<key.length;i++){s^=key.charCodeAt(i);s=Math.imul(s,16777619);}
  let seed=s>>>0;
  return()=>{seed|=0;seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};
}

function seedInningsCore(rng,{team1,team2,runs,wickets,balls,squad1,squad2,complete}){
  const segN=SEGS.length;
  // extras: a handful of wides (1 run each, no legal ball consumed)
  const wideN=Math.min(Math.floor(runs*0.08), 2+Math.floor(rng()*6));
  const widePos=new Set();
  while(widePos.size<wideN)widePos.add(Math.floor(rng()*balls));
  const batTarget=runs-wideN;
  // plan legal-ball outcomes: exact batTarget over `balls` with `wickets` W-balls
  const out=new Array(balls).fill(0);
  const wkPos=new Set();
  while(wkPos.size<wickets){const p=6+Math.floor(rng()*Math.max(1,balls-12));if(![...wkPos].some(q=>Math.abs(q-p)<4))wkPos.add(p);}
  const scoring=[];
  for(let i=0;i<balls;i++) if(!wkPos.has(i)) scoring.push(i);
  const pick=()=>{const r=rng();return r<.34?0:r<.63?1:r<.74?2:r<.89?4:r<.95?6:3;};
  scoring.forEach(i=>out[i]=pick());
  let sum=out.reduce((a,b)=>a+b,0);
  while(sum!==batTarget){
    const i=scoring[Math.floor(rng()*scoring.length)];
    if(sum<batTarget&&out[i]<6){out[i]++;sum++;}
    else if(sum>batTarget&&out[i]>0){out[i]--;sum--;}
  }
  const inn=initInn(team1,team2,squad1,null,team1,squad2,team2);
  const mkBat=n=>({id:n,name:n,runs:0,balls:0,fours:0,sixes:0,status:"batting",dismissal:null});
  let queue=[...squad1];
  let striker=mkBat(queue.shift()), nonStriker=mkBat(queue.shift());
  inn.batsmen=[striker,nonStriker];
  const bowlNames=squad2.slice(6,10);
  const getBowler=n=>{let b=inn.bowlers.find(x=>x.name===n);if(!b){b={id:n,name:n,balls:0,runs:0,wickets:0,maidens:0,wides:0,noBalls:0};inn.bowlers=[...inn.bowlers,b];}return b;};
  const MODES=["Caught","Bowled","LBW","Caught"];
  inn.curPartner={runs:0,balls:0,bat1:striker.id,bat2:nonStriker.id};
  let bow=null, overRuns=0;
  for(let i=0;i<balls;i++){
    const overN=Math.floor(i/6), bio=i%6;
    if(bio===0){
      const prev=bow;
      let cand=bowlNames[overN%bowlNames.length];
      if(prev&&cand===prev.name)cand=bowlNames[(overN+1)%bowlNames.length];
      bow=getBowler(cand); overRuns=0;
    }
    if(widePos.has(i)){ // wide before this legal delivery
      inn.runs+=1; inn.extras.wide+=1; bow.runs+=1; bow.wides++; overRuns+=1;
      logBallSeed(inn,{type:"Wd",value:0,shot:null,seg:null,zone:null,bowlerApproach:null,over:overN,ballInOver:bio,striker:striker.id,bowler:bow.id});
    }
    const isW=wkPos.has(i), v=isW?0:out[i];
    const ball={type:isW?"W":"run",value:v,
      shot:null,seg:v>0?Math.floor(rng()*segN):null,zone:null,bowlerApproach:null,
      over:overN,ballInOver:bio,striker:striker.id,bowler:bow.id,
      ...(isW?{dismissal:MODES[Math.floor(rng()*MODES.length)]}:{})};
    inn.balls++; bow.balls++;
    if(isW){
      striker.status="out";
      striker.dismissal=`${ball.dismissal}${ball.dismissal==="Caught"?` - ${squad2[Math.floor(rng()*6)]}`:""} b. ${bow.name}`;
      striker.balls++; bow.wickets++; inn.wickets++;
      inn.fow=[...inn.fow,{runs:inn.runs,wickets:inn.wickets,batsman:striker.name,overs:fmtOv(inn.balls)}];
      logBallSeed(inn,ball);
      if(inn.curPartner.runs>0||inn.curPartner.balls>0){
        inn.partnerships=[...inn.partnerships,{bat1:striker.name,bat2:nonStriker.name,runs:inn.curPartner.runs,balls:inn.curPartner.balls,wicket:inn.wickets}];
      }
      striker=mkBat(queue.shift());
      inn.batsmen=[...inn.batsmen,striker];
      inn.curPartner={runs:0,balls:0,bat1:striker.id,bat2:nonStriker.id};
    }else{
      striker.runs+=v; striker.balls++;
      if(v===4)striker.fours++; if(v===6)striker.sixes++;
      inn.runs+=v; bow.runs+=v; overRuns+=v;
      inn.curPartner={...inn.curPartner,runs:inn.curPartner.runs+v,balls:inn.curPartner.balls+1};
      logBallSeed(inn,ball);
      if(v%2===1)[striker,nonStriker]=[nonStriker,striker];
    }
    if(bio===5){
      if(overRuns===0)bow.maidens++;
      [striker,nonStriker]=[nonStriker,striker];
    }
  }
  inn.striker=striker.id; inn.nonStriker=nonStriker.id; inn.bowler=bow?bow.id:null;
  if(complete){
    inn.complete=true;
    // close the live partnership for completed innings
    if(inn.curPartner.balls>0)inn.partnerships=[...inn.partnerships,{bat1:striker.name,bat2:nonStriker.name,runs:inn.curPartner.runs,balls:inn.curPartner.balls,wicket:inn.wickets}];
  }
  return inn;
}

function seedLiveResume({matchId,team1,team2,overs,runs,wickets,balls,squad1,squad2}){
  const rng=seedRng(matchId);
  const inn=seedInningsCore(rng,{team1,team2,runs,wickets,balls,squad1,squad2,complete:false});
  const inn2=initInn(team2,team1,squad2,null,team2,squad1,team1);
  // matchId rides in cfg so the scorer can key its saved log by it.
  return { cfg:{matchId,team1,team2,overs,squad1,squad2,teamKey1:team1,teamKey2:team2}, innings:[inn,inn2], curIn:0 };
}

// Full completed-match reconstruction — both innings from the summary card.
// `liveLast` marks the final innings as still in progress (live or
// interrupted match) so it is never presented as a completed innings.
function seedCompletedMatch({matchId,team1,team2,squad1,squad2,inns,liveLast}){
  const rng=seedRng(matchId);
  const last=inns.length-1;
  const innings=inns.map((x,i)=> i===0
    ? seedInningsCore(rng,{team1,team2,runs:x.runs,wickets:x.wickets,balls:x.balls,squad1,squad2,complete:!(liveLast&&i===last)})
    : seedInningsCore(rng,{team1:team2,team2:team1,runs:x.runs,wickets:x.wickets,balls:x.balls,squad1:squad2,squad2:squad1,complete:!(liveLast&&i===last)}));
  return { cfg:{team1,team2,overs:20,squad1,squad2,teamKey1:team1,teamKey2:team2}, innings };
}

// standalone twin of the component-scoped logBall (identical logic)
function logBallSeed(i,ball){
  i.ballLog=[...i.ballLog,ball];
  const ov=ball.over;
  const last=i.overLog.length?i.overLog[i.overLog.length-1]:null;
  if(!last||last.over!==ov)i.overLog=[...i.overLog,{over:ov,balls:[ball]}];
  else{const ol=[...i.overLog];ol[ol.length-1]={...ol[ol.length-1],balls:[...ol[ol.length-1].balls,ball]};i.overLog=ol;}
}

export { logBallSeed, seedCompletedMatch, seedInningsCore, seedLiveResume, seedRng };
