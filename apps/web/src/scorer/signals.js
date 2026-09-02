import { D } from "../design/tokens.js";
import { fmtOv } from "./format.js";

/* ═══════════════════════════════════════════════════════
   INTELLIGENCE ENGINE
═══════════════════════════════════════════════════════ */
const getPhase=(balls,overs)=>{
  const ov=Math.floor(balls/6)+1;
  if(overs<=10)return ov<=3?"POWERPLAY":ov<=7?"MIDDLE":"DEATH";
  if(overs<=20)return ov<=6?"POWERPLAY":ov<=15?"MIDDLE":"DEATH";
  return ov<=10?"POWERPLAY":ov<=40?"MIDDLE":"DEATH";
};

const buildSignals=(inn,overs,target,isChase)=>{
  if(!inn||inn.balls===0)return null;
  const{runs,wickets,balls,ballLog,batsmen,bowlers}=inn;
  const maxBalls=overs*6,rr=balls>0?(runs/(balls/6)):0;
  const reqRr=isChase&&target&&balls<maxBalls?((target-runs)/((maxBalls-balls)/6)):null;
  const rrDelta=reqRr!=null?rr-reqRr:null;
  const projected=balls>0?Math.round(runs/(balls/maxBalls)):0;
  const ll=n=>ballLog.filter(b=>b.type!=="Wd"&&b.type!=="Nb").slice(-n);
  const l6=ballLog.slice(-6),l12=ballLog.slice(-12),ll6=ll(6),ll12=ll(12);
  const dotsL6=ll6.filter(b=>b.value===0&&b.type==="run").length;
  const dotsL12=ll12.filter(b=>b.value===0&&b.type==="run").length;
  const bndsL6=l6.filter(b=>b.value===4||b.value===6).length;
  const bndsL12=l12.filter(b=>b.value===4||b.value===6).length;
  const wktsL12=l12.filter(b=>b.type==="W").length;
  const runsL6=l6.reduce((s,b)=>s+(b.value||0),0);
  const runsL12=l12.reduce((s,b)=>s+(b.value||0),0);
  const lastBndIdx=[...ballLog].reverse().findIndex(b=>b.value===4||b.value===6);
  const bndDrought=lastBndIdx===-1?balls:lastBndIdx;
  const curBow=bowlers.find(b=>b.id===inn.bowler);
  const curBowEcon=curBow?.balls>0?+(curBow.runs/(curBow.balls/6)).toFixed(2):0;
  const striker=batsmen.find(b=>b.id===inn.striker);
  const strikerSR=striker?.balls>0?+((striker.runs/striker.balls)*100).toFixed(1):0;
  const lastWktIdx=[...ballLog].reverse().findIndex(b=>b.type==="W");
  const pshipBalls=lastWktIdx===-1?balls:lastWktIdx;
  const pshipRuns=lastWktIdx===-1?runs:ballLog.slice(ballLog.length-lastWktIdx).reduce((s,b)=>s+(b.value||0),0);
  let pressure=30;
  if(dotsL6>=4)pressure+=18;if(dotsL12>=8)pressure+=10;
  if(wktsL12>=2)pressure+=22;if(wktsL12>=3)pressure+=12;
  if(bndDrought>=18)pressure+=10;
  if(reqRr!=null&&reqRr-rr>2)pressure+=15;
  if(reqRr!=null&&reqRr-rr>4)pressure+=10;
  if(striker?.balls<8&&wickets>0)pressure+=8;
  pressure=Math.min(100,Math.max(0,pressure));
  const pLbl=pressure<26?"LOW":pressure<51?"MED":pressure<76?"HIGH":"EXTREME";
  const pCol=pressure<26?D.emerald:pressure<51?D.amber:pressure<76?D.orange:D.rose;
  let mom=0;
  const recentRR=ll12.length>0?(runsL12/(ll12.length/6)):0;
  mom+=(recentRR-rr)*10;mom-=wktsL12*18;mom+=bndsL12*8;
  mom=Math.min(100,Math.max(-100,mom));
  const mLbl=mom>20?"BAT":mom<-20?"BOWL":"EVEN";
  const mCol=mom>20?D.emerald:mom<-20?D.rose:D.amber;
  const phase=getPhase(balls,overs);
  const flags=[];
  if(isChase&&reqRr&&rrDelta>0.5)flags.push("CHASE_ON_TRACK");
  if(isChase&&reqRr&&rrDelta<-1&&maxBalls-balls>18)flags.push("CHASE_BEHIND");
  if(wktsL12>=2||(striker?.balls<8&&wickets>=3))flags.push("COLLAPSE_RISK");
  if(runsL6>=12||bndsL6>=2)flags.push("BOWLER_UNDER_PUMP");
  if(striker?.balls<12&&wickets>0)flags.push("NEW_BATTER_SETTLING");
  if(pshipBalls>=24&&pshipRuns>=30)flags.push("PARTNERSHIP_STABILISING");
  if(bndDrought>=18)flags.push("BOUNDARY_DROUGHT");
  if(phase==="DEATH")flags.push("DEATH_OVERS");
  if(curBow?.wickets>=1&&curBow?.balls%6===3)flags.push("HAT_TRICK_POSSIBLE");
  return{rr:+rr.toFixed(2),reqRr:reqRr?+reqRr.toFixed(2):null,rrDelta:rrDelta?+rrDelta.toFixed(2):null,
    projected,dotsL6,dotsL12,bndsL6,bndsL12,wktsL12,runsL6,runsL12,bndDrought,
    curBowEcon,curBow,striker,strikerSR,strikerBalls:striker?.balls||0,
    pshipRuns,pshipBalls,pressure,pressureLabel:pLbl,pressureColor:pCol,
    mom:+mom.toFixed(0),momLabel:mLbl,momColor:mCol,phase,flags,
    runs,wickets,balls,overs,maxBalls,isChase,target};
};

const buildNarratives=(sig,lastOver)=>{
  if(!sig)return[];const n=[];
  const push=(type,pri,hl,chips,accent=D.emerald,icon="")=>n.push({type,pri,hl,chips,accent,icon});
  if(lastOver?.balls.length===6){
    const ovR=lastOver.balls.reduce((s,b)=>s+(b.value||0),0);
    const ovW=lastOver.balls.filter(b=>b.type==="W").length;
    const ovB=lastOver.balls.filter(b=>b.value===4||b.value===6).length;
    const ovD=lastOver.balls.filter(b=>b.value===0&&b.type==="run").length;
    const imp=ovR>=14?"HIGH":ovR>=8?"MED":"LOW";
    const ic=imp==="HIGH"?D.amber:imp==="MED"?D.orange:D.textSecondary;
    push("END_OF_OVER",92,`Over ${lastOver.over+1}: ${ovR} run${ovR!==1?"s":""}${ovW?" · "+ovW+"W":""}`,
      [{l:"Runs",v:ovR,c:ic},{l:"Dots",v:ovD},{l:"Bnds",v:ovB},{l:"Impact",v:imp,c:ic}],ic,"📋");
  }
  if(sig.flags.includes("HAT_TRICK_POSSIBLE")&&sig.curBow)
    push("HAT_TRICK",96,`Hat-trick ball — ${sig.curBow.name}`,[{l:"Wickets",v:sig.curBow.wickets,c:D.rose},{l:"This spell",v:sig.curBow.balls>0?fmtOv(sig.curBow.balls):"0"}],D.rose,"🎩");
  if(sig.isChase&&sig.reqRr!=null){
    const need=(sig.target||0)-sig.runs;
    const ballsLeft=sig.maxBalls-sig.balls;
    if(sig.rrDelta<-1)push("CHASE_BEHIND",83,`Need ${need} off ${ballsLeft} balls`,
      [{l:"RRR",v:sig.reqRr,c:D.rose},{l:"CRR",v:sig.rr},{l:"Behind",v:"+"+Math.abs(sig.rrDelta).toFixed(1),c:D.rose}],D.rose,"🎯");
    else push("CHASE_ON_TRACK",66,`${need} from ${ballsLeft} — on track`,
      [{l:"RRR",v:sig.reqRr,c:D.emerald},{l:"CRR",v:sig.rr,c:D.emerald},{l:"Ahead",v:sig.rrDelta>0?"+"+sig.rrDelta.toFixed(1):"—",c:D.emerald}],D.emerald,"✅");
  }
  if(sig.pressure>=75)push("PRESSURE",80,
    sig.pressureLabel==="EXTREME"?"Under extreme pressure":"Batting under pressure",
    [{l:"Dots/6",v:sig.dotsL6,c:sig.pressureColor},{l:"Score",v:sig.pressure+"%",c:sig.pressureColor},{l:"Drought",v:sig.bndDrought+"b"}],sig.pressureColor,"🔥");
  if(Math.abs(sig.mom)>40)push("MOMENTUM",70,
    sig.momLabel==="BAT"?"Bat dominating — bowler under pump":"Bowlers wrestling control back",
    [{l:"Last 6",v:sig.runsL6+"r"},{l:"Bnds/12",v:sig.bndsL12},{l:"Wkts/12",v:sig.wktsL12}],sig.momColor,sig.momLabel==="BAT"?"💥":"⚡");
  if(sig.flags.includes("COLLAPSE_RISK"))push("COLLAPSE",78,`${sig.wktsL12} wickets in last 12 balls — nervy`,
    [{l:"Wickets",v:sig.wktsL12,c:D.rose},{l:"Dots/12",v:sig.dotsL12},{l:"New bat",v:sig.strikerBalls<10?"Yes":"—"}],D.rose,"📉");
  if(sig.flags.includes("NEW_BATTER_SETTLING")&&sig.striker)push("SETTLING",55,`${sig.striker.name} at the crease`,
    [{l:"Balls",v:sig.strikerBalls},{l:"Runs",v:sig.striker.runs},{l:"SR",v:sig.strikerSR}],D.sky,"🏏");
  if(sig.flags.includes("PARTNERSHIP_STABILISING"))push("PARTNERSHIP",50,"Partnership steadying the ship",
    [{l:"P'ship",v:sig.pshipRuns+"("+sig.pshipBalls+"b)"},{l:"Rate",v:sig.pshipBalls>0?(sig.pshipRuns/(sig.pshipBalls/6)).toFixed(1):"—"}],D.emerald,"🤝");
  if(sig.flags.includes("BOUNDARY_DROUGHT")&&!sig.flags.includes("PRESSURE"))push("DROUGHT",52,
    `Boundary drought — ${sig.bndDrought} balls`,
    [{l:"Drought",v:sig.bndDrought+"b",c:D.amber},{l:"Dots/6",v:sig.dotsL6},{l:"Proj",v:sig.projected}],D.amber,"🌵");
  if(!sig.isChase&&sig.balls>=24)push("PROJECTION",38,
    `At this rate: ${sig.projected} projected`,
    [{l:"RR",v:sig.rr},{l:"Balls left",v:sig.maxBalls-sig.balls},{l:"Phase",v:sig.phase}],D.violet,"📊");
  // Always push a baseline RR card
  if(!sig.isChase)push("RUN_RATE",10,`Run rate: ${sig.rr} rpo`,
    [{l:"Runs",v:sig.runs},{l:"Overs",v:fmtOv(sig.balls)},{l:"Proj",v:sig.projected}],D.sky,"📈");
  return n.sort((a,b)=>b.pri-a.pri);
};

export { buildNarratives, buildSignals, getPhase };
