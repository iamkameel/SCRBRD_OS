import { fetchCommentary } from "../lib/ai.js";
import { D } from "../design/tokens.js";
import { SEGS } from "./field.js";

/* ═══════════════════════════════════════════════════════
   SHOT TYPES — for ball-by-ball commentary
═══════════════════════════════════════════════════════ */
const SHOT_CATEGORIES = [
  {
    cat:"Attacking",color:D.amber,
    shots:[
      {id:"drive",label:"Drive"},
      {id:"pull",label:"Pull"},
      {id:"hook",label:"Hook"},
      {id:"cut",label:"Cut"},
      {id:"sweep",label:"Sweep"},
      {id:"ramp",label:"Ramp/Scoop"},
      {id:"flick",label:"Flick"},
      {id:"glance",label:"Glance"},
      {id:"loft",label:"Lofted Drive"},
      {id:"slog",label:"Slog"},
    ]
  },
  {
    cat:"Defensive",color:D.sky,
    shots:[
      {id:"fwd_def",label:"Forward Def"},
      {id:"back_def",label:"Back Def"},
      {id:"padded",label:"Padded Away"},
    ]
  },
  {
    cat:"Body Contact",color:D.violet,
    shots:[
      {id:"hit_body",label:"Hit Body"},
      {id:"hit_glove",label:"Hit Glove"},
      {id:"hit_helmet",label:"Hit Helmet"},
      {id:"hit_arm",label:"Hit Arm"},
      {id:"missed",label:"Missed / Beat"},
      {id:"inside_edge",label:"Inside Edge"},
      {id:"outside_edge",label:"Outside Edge"},
      {id:"top_edge",label:"Top Edge"},
      {id:"leading_edge",label:"Leading Edge"},
    ]
  },
  {
    cat:"Unusual",color:D.orange,
    shots:[
      {id:"reverse_sweep",label:"Reverse Sweep"},
      {id:"switch_hit",label:"Switch Hit"},
      {id:"paddle",label:"Paddle"},
      {id:"lap",label:"Lap"},
    ]
  },
];

const ALL_SHOTS = SHOT_CATEGORIES.flatMap(c=>c.shots.map(s=>({...s,cat:c.cat,color:c.color})));

/* ═══════════════════════════════════════════════════════
   SHOT CATALOGUE  (icon grid for Scoring Hub stage 0)
═══════════════════════════════════════════════════════ */
const SHOT_CATS = [
  {cat:"Attacking", color:"#f59e0b", shots:[
    {id:"drive",       label:"Drive",      icon:"🏏"},
    {id:"pull",        label:"Pull",       icon:"💪"},
    {id:"hook",        label:"Hook",       icon:"🪝"},
    {id:"cut",         label:"Cut",        icon:"✂️"},
    {id:"sweep",       label:"Sweep",      icon:"🧹"},
    {id:"ramp",        label:"Ramp",       icon:"🚀"},
    {id:"flick",       label:"Flick",      icon:"👆"},
    {id:"glance",      label:"Glance",     icon:"🎯"},
    {id:"loft",        label:"Loft",       icon:"🌤️"},
    {id:"slog",        label:"Slog",       icon:"💥"},
  ]},
  {cat:"Defensive", color:"#0ea5e9", shots:[
    {id:"fwd_def",     label:"Fwd Def",    icon:"🛡️"},
    {id:"back_def",    label:"Back Def",   icon:"🔙"},
    {id:"padded",      label:"Padded",     icon:"🦵"},
  ]},
  {cat:"Edge / Contact", color:"#7c3aed", shots:[
    {id:"outside_edge",label:"Out Edge",   icon:"🔪"},
    {id:"inside_edge", label:"In Edge",    icon:"↩️"},
    {id:"top_edge",    label:"Top Edge",   icon:"⬆️"},
    {id:"hit_body",    label:"Hit Body",   icon:"🤕"},
    {id:"hit_glove",   label:"Hit Glove",  icon:"🧤"},
    {id:"missed",      label:"Missed",     icon:"❌"},
  ]},
  {cat:"Special", color:"#f97316", shots:[
    {id:"reverse_sweep",label:"Rev Sweep", icon:"🔄"},
    {id:"switch_hit",  label:"Switch Hit", icon:"↔️"},
    {id:"paddle",      label:"Paddle",     icon:"🏓"},
  ]},
];

const ALL_SHOTS_FLAT = SHOT_CATS.flatMap(c=>c.shots.map(s=>({...s,cat:c.cat,color:c.color})));

/* ═══════════════════════════════════════════════════════
   AI COMMENTARY ENGINE
═══════════════════════════════════════════════════════ */
async function fetchAICommentary(ball,inn,milestone){
  const shot=ball.shot?ALL_SHOTS_FLAT.find(s=>s.id===ball.shot):null;
  const seg=ball.seg!=null?SEGS[ball.seg]:null;
  const batsman=inn?.batsmen.find(b=>b.id===ball.striker);
  const bowler=inn?.bowlers.find(b=>b.id===ball.bowler);
  const score=inn?inn.runs+"/"+inn.wickets:"?";
  const over="Over "+(ball.over+1)+", ball "+(ball.ballInOver+1);
  const maxBalls=(inn?.balls||0);
  const totalOvers=Math.floor(maxBalls/6);
  const phase=totalOvers<6?"powerplay":totalOvers<15?"middle overs":"death overs";
  // Build rich context
  let eventDesc="";
  if(ball.type==="W")eventDesc=`WICKET — ${batsman?.name||"batter"} dismissed ${ball.dismissal}${bowler?" bowled by "+bowler.name:""}`;
  else if(ball.type==="Wd")eventDesc="Wide delivery, sloppy line";
  else if(ball.type==="Nb")eventDesc=`No ball (${(ball.nbType||"front foot").replace("_"," ")}), ${ball.value||0} runs off bat`;
  else if(ball.type==="B")eventDesc=`Byes — ${ball.value} run${ball.value!==1?"s":""}`;
  else if(ball.type==="LB")eventDesc=`Leg byes — ${ball.value} run${ball.value!==1?"s":""}`;
  else if(ball.value===6)eventDesc="SIX! Maximum — ball disappears into the crowd!";
  else if(ball.value===4)eventDesc="FOUR! Races away to the boundary!";
  else if(ball.value===0)eventDesc="Dot ball — beaten or blocked";
  else eventDesc=`${ball.value} run${ball.value!==1?"s":""}`;
  // Partnership context
  const partner=inn?.curPartner;
  const partnerInfo=partner&&(partner.runs>0||partner.balls>0)?
    ` | Partnership: ${partner.runs} runs off ${partner.balls} balls`:""
  // Recent over analysis
  const recentBalls=inn?.ballLog?.slice(-6)||[];
  const recentRuns=recentBalls.reduce((s,b)=>s+(b.value||0),0);
  const hasMomentum=recentRuns>=12;
  const batContext=batsman?` | ${batsman.name}: ${batsman.runs}* (${batsman.balls}b, SR ${batsman.balls?Math.round(batsman.runs/batsman.balls*100):0})`:"";
  const bowlContext=bowler?` | ${bowler.name}: ${Math.floor(bowler.balls/6)}-${bowler.balls%6} ${bowler.runs}r ${bowler.wickets}w`:"";
  const milestoneCtx=milestone?` | MILESTONE: ${milestone}`:"";
  // Situation only. The commentator persona, the word count and the
  // formatting rules are the service's system prompt, so they are versioned
  // in one place rather than rebuilt per ball here.
  const prompt=`Match context: ${score} off ${over}, ${phase}${hasMomentum?" — batting team on a roll":""}
Ball: ${eventDesc}${shot?" | Shot: "+shot.label:""}${seg?" | "+seg.label+(ball.zone==="boundary"?" (boundary)":ball.zone==="outer"?" (outfield)":""):""}${ball.bowlerApproach?" | Bowling "+ball.bowlerApproach:""}${batContext}${bowlContext}${partnerInfo}${milestoneCtx}`;
  // Enhancement layer only: returns null on any failure, and no scoring path
  // awaits it. A ball must be recordable with the network entirely absent.
  return await fetchCommentary(prompt);
}

export { ALL_SHOTS, ALL_SHOTS_FLAT, SHOT_CATEGORIES, SHOT_CATS };
