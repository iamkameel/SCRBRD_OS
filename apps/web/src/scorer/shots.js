import { fetchCommentary } from "../lib/ai.js";
import { D, themed } from "../design/tokens.js";
import { SEGS } from "./field.js";

/* ═══════════════════════════════════════════════════════
   SHOT TYPES — for ball-by-ball commentary
═══════════════════════════════════════════════════════ */
const SHOT_CATEGORIES = themed(() => [
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
], []);

const ALL_SHOTS = themed(() => SHOT_CATEGORIES.flatMap(c=>c.shots.map(s=>({...s,cat:c.cat,color:c.color}))), []);

/* ═══════════════════════════════════════════════════════
   SHOT CATALOGUE  (the word grid for Scoring Hub stage 0)
   Words, with no icon (DESIGN_DIRECTION §3.4): "Drive" reads faster than a
   picture of a bat, and there are twenty-two of them.
═══════════════════════════════════════════════════════ */
const SHOT_CATS = themed(() => [
  {cat:"Attacking", color:D.amber, shots:[
    {id:"drive",       label:"Drive"},
    {id:"pull",        label:"Pull"},
    {id:"hook",        label:"Hook"},
    {id:"cut",         label:"Cut"},
    {id:"sweep",       label:"Sweep"},
    {id:"ramp",        label:"Ramp"},
    {id:"flick",       label:"Flick"},
    {id:"glance",      label:"Glance"},
    {id:"loft",        label:"Loft"},
    {id:"slog",        label:"Slog"},
  ]},
  {cat:"Defensive", color:D.sky, shots:[
    {id:"fwd_def",     label:"Fwd Def"},
    {id:"back_def",    label:"Back Def"},
    {id:"padded",      label:"Padded"},
  ]},
  {cat:"Edge / Contact", color:D.violet, shots:[
    {id:"outside_edge",label:"Out Edge"},
    {id:"inside_edge", label:"In Edge"},
    {id:"top_edge",    label:"Top Edge"},
    {id:"hit_body",    label:"Hit Body"},
    {id:"hit_glove",   label:"Hit Glove"},
    {id:"missed",      label:"Missed"},
  ]},
  {cat:"Special", color:D.orange, shots:[
    {id:"reverse_sweep",label:"Rev Sweep"},
    {id:"switch_hit",  label:"Switch Hit"},
    {id:"paddle",      label:"Paddle"},
  ]},
], []);

const ALL_SHOTS_FLAT = themed(() => SHOT_CATS.flatMap(c=>c.shots.map(s=>({...s,cat:c.cat,color:c.color}))), []);

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
  else if(ball.type==="Nb")eventDesc=`No ball (${(ball.nbType||"front foot").replace("_"," ")}), ${ball.value||0} ${ball.nbRuns?(ball.nbRuns==="leg_byes"?"leg byes":"byes"):"runs off bat"}`;
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
  // The names the situation mentions, so the service can token them out
  // before the model sees the line and put them back after.
  return await fetchCommentary(prompt, [batsman?.name, bowler?.name].filter(Boolean));
}

// fetchAICommentary was defined here and exported nowhere, while
// panels.jsx called it — so opening PRO MODE threw
// "fetchAICommentary is not defined" and took the whole scorer down with it,
// blank screen, mid-match. The bundler cannot see this: an undefined free
// variable is legal JavaScript right up until the line runs.
export { ALL_SHOTS, ALL_SHOTS_FLAT, SHOT_CATEGORIES, SHOT_CATS, fetchAICommentary };
