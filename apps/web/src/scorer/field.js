import { D } from "../design/tokens.js";

/* ═══════════════════════════════════════════════════════
   FIELD GEOMETRY
═══════════════════════════════════════════════════════ */
const CX=150,CY=150,R_IN=56,R_MID=104,R_BND=124,R_PITCH=13;

const toXY=(deg,r)=>[CX+r*Math.sin(deg*Math.PI/180),CY-r*Math.cos(deg*Math.PI/180)];

const ringArc=(cDeg,ro,ri)=>{
  const s=cDeg-15,e=cDeg+15;
  const[ax,ay]=toXY(s,ro);const[bx,by]=toXY(e,ro);
  const[cx,cy]=toXY(s,ri);const[dx,dy]=toXY(e,ri);
  return `M${cx} ${cy} L${ax} ${ay} A${ro} ${ro} 0 0 1 ${bx} ${by} L${dx} ${dy} A${ri} ${ri} 0 0 0 ${cx} ${cy} Z`;
};

const pieSlice=(cDeg,ro)=>{
  const s=cDeg-15,e=cDeg+15;
  const[ax,ay]=toXY(s,ro);const[bx,by]=toXY(e,ro);
  return `M${CX} ${CY} L${ax} ${ay} A${ro} ${ro} 0 0 1 ${bx} ${by} Z`;
};

const SEGS=[
  {id:0,label:"Fine Leg",short:"FLG",angle:0,side:"leg"},
  {id:1,label:"Sq Leg",short:"SQL",angle:30,side:"leg"},
  {id:2,label:"Mid Wicket",short:"MWK",angle:60,side:"leg"},
  {id:3,label:"Mid On",short:"MON",angle:90,side:"leg"},
  {id:4,label:"Long On",short:"LON",angle:120,side:"leg"},
  {id:5,label:"Deep Mid-On",short:"DMO",angle:150,side:"leg"},
  {id:6,label:"Straight",short:"STR",angle:180,side:"neutral"},
  {id:7,label:"Long Off",short:"LOF",angle:210,side:"off"},
  {id:8,label:"Mid Off",short:"MOF",angle:240,side:"off"},
  {id:9,label:"Cover",short:"COV",angle:270,side:"off"},
  {id:10,label:"Point",short:"PNT",angle:300,side:"off"},
  {id:11,label:"Third Man",short:"3MN",angle:330,side:"off"},
];

const LK_COLS={"4":D.indigo,"6":D.amber,"1-3":D.emerald,"0":D.textMuted,"W":D.rose,"extras":D.orange};

const lineKey=b=>{
  if(b.type==="W")return"W";
  if(b.type==="Wd"||b.type==="Nb")return"extras";
  if(b.value===6)return"6";if(b.value===4)return"4";
  if(b.value===0)return"0";return"1-3";
};

const heatColor=(v,mx)=>{
  if(!mx||!v)return null;const t=v/mx;
  if(t<.25)return`rgba(16,185,129,${.22+t*2})`;
  if(t<.5) return`rgba(245,158,11,${.3+t*1.2})`;
  if(t<.75)return`rgba(249,115,22,${.38+t})`;
  return`rgba(244,63,94,${.5+t*.5})`;
};

const wagEnd=(ang,b)=>{
  let r;
  if(b.type==="W")r=28;
  else if(b.value===6)r=R_BND+13;
  else if(b.value===4||b.zone==="boundary")r=R_BND-1;
  else if(b.value===3)r=R_MID-10;
  else if(b.value===2||b.zone==="outer")r=R_MID-24;
  else if(b.value===1||b.zone==="inner")r=R_IN+10;
  else r=R_IN-16;
  return toXY(ang,r);
};

export { CX, CY, LK_COLS, R_BND, R_IN, R_MID, R_PITCH, SEGS, heatColor, lineKey, pieSlice, ringArc, toXY, wagEnd };
