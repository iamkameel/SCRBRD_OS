import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { askStatGuru, fetchCommentary } from "./lib/ai.js";

/* ═══════════════════════════════════════════════════════
   SCRBRD  —  Hilton College CC
   Full school cricket ecosystem platform
   RBAC · CRUD · Analytics · Skills · Training · Injuries
═══════════════════════════════════════════════════════ */

// ── DESIGN TOKENS ──────────────────────────────────────
import SCRBRD_LOGO from "./assets/scrbrd-logo.jpg";

const D = {
  // ── Base surfaces (unified · SCRBRD canonical) ──
  bg:"#060910", base:"#060910",                 // base + bg aliased
  surf0:"#0a0f1a", surf1:"#0f1621", surf2:"#151d2e", surf3:"#1c2640",
  glass:"rgba(10,14,28,0.75)",
  border:"rgba(255,255,255,0.07)", borderMed:"rgba(255,255,255,0.12)",
  // ── Text ──
  textPrimary:"#f0f4ff", textSecondary:"#8b9bc4", textMuted:"#4a5570",
  // ── Accent palette ──
  indigo:"#6366f1", sky:"#0ea5e9", emerald:"#10b981", amber:"#f59e0b",
  rose:"#f43f5e", orange:"#f97316", violet:"#8b5cf6", cyan:"#06b6d4",
  teal:"#14b8a6", lime:"#84cc16", pink:"#ec4899",
  // ── Gradients (grad + gradMain aliased) ──
  grad:"linear-gradient(135deg,#6366f1,#0ea5e9)",
  gradMain:"linear-gradient(135deg,#6366f1,#0ea5e9)",
  gradGold:"linear-gradient(135deg,#f59e0b,#f97316)",
  gradLive:"linear-gradient(135deg,#10b981,#06b6d4)",
  // ── Radius ──
  sm:"6px", md:"10px", lg:"14px", xl:"18px", xxl:"24px", pill:"9999px",
  // ── Type ──
  mono:"'DM Mono',monospace", head:"'Syne',sans-serif", body:"'DM Sans',sans-serif",
};

// ── ROLE CONFIG ─────────────────────────────────────────

const ROLES = {
  superadmin:   { label:"Super Admin",    color:"#8b5cf6", icon:"⚡", nav:["dashboard","matches","competitions","leagues","squad","profiles","analytics","skills","training","injuries","logistics","fields","staff","calendar","management","rulebook","pitchdeck","notifications","settings"] },
  schooladmin:  { label:"School Admin",   color:"#6366f1", icon:"🏫", nav:["dashboard","matches","competitions","squad","profiles","analytics","logistics","fields","staff","calendar","management","notifications","settings"] },
  coach:        { label:"Coach",          color:"#10b981", icon:"🎯", nav:["dashboard","matches","squad","profiles","analytics","skills","training","injuries","logistics","fields","calendar","management","notifications"] },
  player:       { label:"Player",         color:"#0ea5e9", icon:"🏏", nav:["dashboard","matches","profiles","analytics","skills","training","injuries","calendar","notifications"] },
  parent:       { label:"Parent",         color:"#f59e0b", icon:"👪",nav:["dashboard","matches","competitions","profiles","logistics","calendar","notifications"] },
  spectator:    { label:"Spectator",      color:"#06b6d4", icon:"👁",  nav:["dashboard","matches","competitions","analytics","calendar"] },
  scorer:       { label:"Scorer",         color:"#f97316", icon:"📋", nav:["dashboard","matches","calendar","notifications"] },
  medical:      { label:"Medical Staff",  color:"#f43f5e", icon:"⚕️",  nav:["dashboard","injuries","squad","profiles","training","calendar","notifications"] },
  driver:       { label:"Driver",         color:"#84cc16", icon:"🚌", nav:["dashboard","logistics","matches","calendar","notifications"] },
  groundskeeper: { label:"Groundskeeper",  color:"#14b8a6", icon:"🌿", nav:["dashboard","fields","matches","calendar","notifications","management"] },
  sportsmaster:  { label:"Sportsmaster",    color:"#f59e0b", icon:"🏅", nav:["dashboard","matches","competitions","leagues","squad","profiles","analytics","calendar","management","notifications","settings"] },
  assistant:     { label:"Coaching Asst",   color:"#22d3ee", icon:"🤝", nav:["dashboard","matches","squad","profiles","skills","training","injuries","calendar","notifications"] },
  headcoach:       { label:"Head Coach",         color:"#10b981", icon:"🧢", nav:["dashboard","matches","squad","profiles","analytics","skills","training","injuries","logistics","fields","calendar","management","notifications"] },
  analyst:         { label:"Performance Analyst", color:"#14b8a6", icon:"📈", nav:["dashboard","matches","competitions","leagues","squad","profiles","analytics","skills","calendar"] },
  headmaster:      { label:"Headmaster",         color:"#8b5cf6", icon:"🎓", nav:["dashboard","matches","competitions","leagues","squad","profiles","analytics","injuries","calendar","management","notifications","settings"] },
  financeadmin:    { label:"Finance Admin",       color:"#84cc16", icon:"💰", nav:["dashboard","profiles","calendar","management","notifications","settings"] },
  platformsupport: { label:"Platform Support",    color:"#06b6d4", icon:"🛟", nav:["dashboard","matches","competitions","squad","profiles","analytics","calendar","notifications"] },
};

const NAV_META = {
  dashboard:    { icon:"⬡",  label:"Dashboard"    },
  matches:      { icon:"🏏",  label:"Match Centre" },
  competitions: { icon:"🏆",  label:"Competitions" },
  leagues:      { icon:"📋",  label:"Leagues"      },
  squad:        { icon:"👥",  label:"Squad"        },
  profiles:     { icon:"👤",  label:"Profiles"     },
  analytics:    { icon:"📊",  label:"Analytics"    },
  skills:       { icon:"🎯",  label:"Skills"       },
  training:     { icon:"💪",  label:"Training"     },
  injuries:     { icon:"🏥",  label:"Injuries"     },
  logistics:    { icon:"🚌",  label:"Logistics"    },
  calendar:     { icon:"📅",  label:"Calendar"     },
  fields:       { icon:"🌿",  label:"Fields"       },
  staff:        { icon:"🔧",  label:"Staff"        },
  notifications:{ icon:"🔔",  label:"Alerts"       },
  settings:     { icon:"⚙️",  label:"Settings"     },
  management:   { icon:"🛠️",  label:"Management"   },
  rulebook:     { icon:"📖",  label:"Rulebook"     },
  pitchdeck:    { icon:"📐",  label:"Pitch Deck"   },
};

// ── MOCK DATA ────────────────────────────────────────────
const SCHOOL = {
  name:"Hilton College", abbr:"HIL", city:"Hilton, KwaZulu-Natal",
  founded:1872, colors:["#003366","#C8A951"],
  address:"1 College Rd, Hilton, 3245",
  province:"KwaZulu-Natal",
  region:"Midlands",
  altitude:"1080m above sea level",
  climate:"Subtropical highland — thunderstorms common Oct–Mar",
};

const KZN_SCHOOLS = [
  { abbr:"MIC", name:"Michaelhouse",           city:"Balgowan",        region:"Midlands", colors:["#8B0000","#FFD700"] },
  { abbr:"MCB", name:"Maritzburg College",      city:"Pietermaritzburg",region:"Midlands", colors:["#003366","#FFFFFF"] },
  { abbr:"DHS", name:"Durban High School",      city:"Durban",          region:"Coastal",  colors:["#006400","#FFD700"] },
  { abbr:"KEA", name:"Kearsney College",        city:"Botha's Hill",    region:"Midlands", colors:["#003087","#FFFFFF"] },
  { abbr:"GLE", name:"Glenwood High School",    city:"Durban",          region:"Coastal",  colors:["#00008B","#FFFFFF"] },
  { abbr:"WES", name:"Westville Boys' High",    city:"Westville",       region:"Coastal",  colors:["#800000","#C0C0C0"] },
  { abbr:"CLF", name:"Clifton School",          city:"Durban",          region:"Coastal",  colors:["#006400","#FFFFFF"] },
  { abbr:"NSC", name:"Northlands Boys High",    city:"Durban",          region:"Coastal",  colors:["#00008B","#FFD700"] },
  { abbr:"SPB", name:"St Henry's Marist",       city:"Durban",          region:"Coastal",  colors:["#8B0000","#FFFFFF"] },
  { abbr:"PMS", name:"Pinetown Boys' High",     city:"Pinetown",        region:"Coastal",  colors:["#006400","#FFFFFF"] },
  { abbr:"RCB", name:"Richard Gush College",    city:"Howick",          region:"Midlands", colors:["#003366","#FFFFFF"] },
];

// ── SCHOOLS REGISTRY (pre-listed for onboarding) ─────
const SCHOOLS_REGISTRY = [
  // KZN Midlands
  { id:"HIL", name:"Hilton College",            city:"Hilton",           province:"KZN", region:"Midlands", type:"Independent" },
  { id:"MIC", name:"Michaelhouse",              city:"Balgowan",         province:"KZN", region:"Midlands", type:"Independent" },
  { id:"MCB", name:"Maritzburg College",        city:"Pietermaritzburg", province:"KZN", region:"Midlands", type:"Government"  },
  { id:"KEA", name:"Kearsney College",          city:"Botha's Hill",     province:"KZN", region:"Midlands", type:"Independent" },
  { id:"RCB", name:"Richard Gush College",      city:"Howick",           province:"KZN", region:"Midlands", type:"Independent" },
  { id:"PMR", name:"St Charles College",        city:"Pietermaritzburg", province:"KZN", region:"Midlands", type:"Independent" },
  // KZN Coastal
  { id:"DHS", name:"Durban High School",        city:"Durban",           province:"KZN", region:"Coastal",  type:"Government"  },
  { id:"GLE", name:"Glenwood High School",      city:"Durban",           province:"KZN", region:"Coastal",  type:"Government"  },
  { id:"WES", name:"Westville Boys' High",      city:"Westville",        province:"KZN", region:"Coastal",  type:"Government"  },
  { id:"CLF", name:"Clifton School",            city:"Durban",           province:"KZN", region:"Coastal",  type:"Independent" },
  { id:"NSC", name:"Northlands Boys High",      city:"Durban",           province:"KZN", region:"Coastal",  type:"Government"  },
  { id:"SPB", name:"St Henry's Marist",         city:"Durban",           province:"KZN", region:"Coastal",  type:"Independent" },
  { id:"PMS", name:"Pinetown Boys' High",       city:"Pinetown",         province:"KZN", region:"Coastal",  type:"Government"  },
  { id:"CBC", name:"Christian Brothers College",city:"Durban",           province:"KZN", region:"Coastal",  type:"Independent" },
  // Gauteng
  { id:"SAC", name:"St Alban's College",        city:"Pretoria",         province:"GP",  region:"North",    type:"Independent" },
  { id:"AFF", name:"Affies",                    city:"Pretoria",         province:"GP",  region:"North",    type:"Government"  },
  { id:"KES", name:"King Edward VII School",    city:"Johannesburg",     province:"GP",  region:"Central",  type:"Government"  },
  { id:"SJC", name:"St John's College",         city:"Johannesburg",     province:"GP",  region:"Central",  type:"Independent" },
  { id:"SAJ", name:"St Andrew's School Jozi",   city:"Johannesburg",     province:"GP",  region:"Central",  type:"Independent" },
  { id:"PRE", name:"Pretoria Boys High",        city:"Pretoria",         province:"GP",  region:"North",    type:"Government"  },
  // Western Cape
  { id:"SAG", name:"SACS (South African College Schools)", city:"Cape Town", province:"WC", region:"Metro",  type:"Government"  },
  { id:"BOL", name:"Boland Landbou",            city:"Paarl",            province:"WC",  region:"Boland",   type:"Government"  },
  { id:"PAA", name:"Paarl Boys' High",          city:"Paarl",            province:"WC",  region:"Boland",   type:"Government"  },
  { id:"STB", name:"Stellenbosch Gimnasium",    city:"Stellenbosch",     province:"WC",  region:"Boland",   type:"Government"  },
  { id:"DIO", name:"Diocesan College (Bishops)",city:"Rondebosch",       province:"WC",  region:"Metro",    type:"Independent" },
  { id:"RCC", name:"Rondebosch Boys' High",     city:"Rondebosch",       province:"WC",  region:"Metro",    type:"Government"  },
  // Eastern Cape
  { id:"SAR", name:"St Andrew's College",       city:"Grahamstown",      province:"EC",  region:"Eastern",  type:"Independent" },
  { id:"KWT", name:"Kingswood College",         city:"Grahamstown",      province:"EC",  region:"Eastern",  type:"Independent" },
  { id:"GRY", name:"Grey High School",          city:"Port Elizabeth",   province:"EC",  region:"Eastern",  type:"Government"  },
  { id:"PEH", name:"Hudson Park High School",   city:"East London",      province:"EC",  region:"Eastern",  type:"Government"  },
  // Other
  { id:"OTH", name:"Other / Not Listed",        city:"",                 province:"",    region:"",         type:"Other"       },
];

// ── DATE HELPERS (must be before any data that uses them) ──
const today   = new Date();
const dateStr = (d) => d.toISOString().split("T")[0];
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };

const PLAYERS = [
  // ── HILTON U19A ──
  { id:"p1",  name:"James Whitfield",    team:"U19A", school:"HIL", role:"BAT",  batHand:"R", bowlArm:"R", bowlStyle:"M",  age:17, fitness:"fit",
    avg:48.2, sr:135.4, wkts:8,  econ:7.2,  cap:"c",  form:[4,2,6,3,5,4,6,3],
    born:"2007-04-12", hometown:"Hilton, KZN", houseAtSchool:"School House",
    height:"182cm", weight:"76kg", battingPos:1,
    bio:"Captain of Hilton U19A. Opening batsman with exceptional technique and temperament. Right-hand top-order bat. Under-19 KZN provincial trialist 2024.",
    careerTotals:{ innings:42, runs:1845, hs:112, fifties:14, hundreds:2, balls:0, wktsTotal:8, maidens:0 },
    seasonForm:[
      {opp:"Michaelhouse",  runs:67,  wkts:0, date:"2025-01-18", result:"W"},
      {opp:"DHS",           runs:34,  wkts:1, date:"2025-01-25", result:"W"},
      {opp:"Kearsney",      runs:91,  wkts:0, date:"2025-02-01", result:"W"},
      {opp:"Maritzburg Col",runs:12,  wkts:0, date:"2025-02-08", result:"L"},
      {opp:"Glenwood",      runs:55,  wkts:1, date:"2025-02-15", result:"W"},
      {opp:"Westville",     runs:72,  wkts:0, date:"2025-02-22", result:"W"},
      {opp:"Kearsney",      runs:null,wkts:0, date:dateStr(today), result:"NR"},
    ],
    vsOpponents:{ Michaelhouse:{P:4,runs:198,avg:49.5}, DHS:{P:3,runs:142,avg:47.3}, Kearsney:{P:4,runs:241,avg:60.3}, "Westville":{P:2,runs:98,avg:49.0} },
  },
  { id:"p2",  name:"Luca De Villiers",   team:"U19A", school:"HIL", role:"BOWL", batHand:"R", bowlArm:"R", bowlStyle:"F",  age:18, fitness:"fit",
    avg:18.4, sr:95.1,  wkts:24, econ:6.8,  form:[2,1,3,0,2,1,4,2],
    born:"2006-08-23", hometown:"Pietermaritzburg, KZN", houseAtSchool:"Allott House",
    height:"188cm", weight:"82kg", battingPos:9,
    bio:"Leading wicket-taker. Express right-arm fast bowler. Consistently clocks 125–130 km/h. KZN U19 squad member 2024.",
    careerTotals:{ innings:38, runs:312, hs:34, fifties:0, hundreds:0, balls:2840, wktsTotal:68, maidens:12 },
    seasonForm:[
      {opp:"Michaelhouse",  runs:8,   wkts:3, date:"2025-01-18", result:"W"},
      {opp:"DHS",           runs:14,  wkts:2, date:"2025-01-25", result:"W"},
      {opp:"Kearsney",      runs:0,   wkts:4, date:"2025-02-01", result:"W"},
      {opp:"Maritzburg Col",runs:22,  wkts:1, date:"2025-02-08", result:"L"},
      {opp:"Glenwood",      runs:5,   wkts:3, date:"2025-02-15", result:"W"},
      {opp:"Westville",     runs:0,   wkts:4, date:"2025-02-22", result:"W"},
    ],
    vsOpponents:{ Michaelhouse:{P:4,wkts:11,avg:18.2}, DHS:{P:3,wkts:8,avg:22.1}, Kearsney:{P:4,wkts:14,avg:15.4}, "Westville":{P:2,wkts:7,avg:12.0} },
  },
  { id:"p3",  name:"Ethan Solomons",     team:"U19A", school:"HIL", role:"ALL",  batHand:"L", bowlArm:"L", bowlStyle:"F",  age:17, fitness:"fit",
    avg:32.1, sr:142.0, wkts:15, econ:7.5,  form:[3,5,4,6,2,3,5,4],
    born:"2007-11-05", hometown:"Durban, KZN", houseAtSchool:"Smith House",
    height:"180cm", weight:"74kg", battingPos:5,
    bio:"Explosive left-hand allrounder. Hard-hitting middle-order bat and left-arm seamer. Known for match-winning innings under pressure.",
    careerTotals:{ innings:39, runs:1024, hs:88, fifties:6, hundreds:0, balls:1920, wktsTotal:42, maidens:4 },
    seasonForm:[
      {opp:"Michaelhouse",  runs:45,  wkts:2, date:"2025-01-18", result:"W"},
      {opp:"DHS",           runs:61,  wkts:1, date:"2025-01-25", result:"W"},
      {opp:"Kearsney",      runs:28,  wkts:3, date:"2025-02-01", result:"W"},
      {opp:"Maritzburg Col",runs:33,  wkts:0, date:"2025-02-08", result:"L"},
      {opp:"Glenwood",      runs:72,  wkts:2, date:"2025-02-15", result:"W"},
      {opp:"Westville",     runs:18,  wkts:2, date:"2025-02-22", result:"W"},
    ],
    vsOpponents:{ Michaelhouse:{P:4,runs:142,avg:35.5,wkts:8}, DHS:{P:3,runs:118,avg:39.3,wkts:5}, Kearsney:{P:4,runs:164,avg:41.0,wkts:9} },
  },
  { id:"p4",  name:"Marcus Ngcobo",      team:"U19A", school:"HIL", role:"WK",   batHand:"R", bowlArm:"R", bowlStyle:"M",  age:18, fitness:"fit",
    avg:29.8, sr:118.2, wkts:0,  econ:0,   form:[2,3,1,4,5,3,2,4],
    born:"2006-03-18", hometown:"Howick, KZN", houseAtSchool:"Day Boys",
    height:"175cm", weight:"70kg", battingPos:7,
    bio:"Wicket-keeper batsman. Sharp behind the stumps with 18 dismissals this season. Reliable middle-order contributor.",
    careerTotals:{ innings:40, runs:876, hs:62, fifties:4, hundreds:0, balls:0, wktsTotal:0, maidens:0, stumpings:22, catches:38 },
    seasonForm:[
      {opp:"Michaelhouse",  runs:22, wkts:0, date:"2025-01-18", result:"W"},
      {opp:"DHS",           runs:44, wkts:0, date:"2025-01-25", result:"W"},
      {opp:"Kearsney",      runs:18, wkts:0, date:"2025-02-01", result:"W"},
      {opp:"Maritzburg Col",runs:31, wkts:0, date:"2025-02-08", result:"L"},
      {opp:"Glenwood",      runs:55, wkts:0, date:"2025-02-15", result:"W"},
      {opp:"Westville",     runs:12, wkts:0, date:"2025-02-22", result:"W"},
    ],
  },
  { id:"p5",  name:"Theo Pretorius",     team:"U19A", school:"HIL", role:"BAT",  batHand:"R", bowlArm:"R", bowlStyle:"S",  age:17, fitness:"injured",
    avg:21.4, sr:108.0, wkts:3,  econ:8.1,  form:[0,0,0,0,1,2,0,0],
    born:"2007-09-30", hometown:"Pietermaritzburg, KZN", houseAtSchool:"School House",
    height:"177cm", weight:"68kg", battingPos:3,
    bio:"Technically correct right-hand bat. Out with hamstring injury since Round 4. Expected return next fixture.",
    careerTotals:{ innings:28, runs:520, hs:71, fifties:3, hundreds:0, balls:180, wktsTotal:3, maidens:0 },
    seasonForm:[
      {opp:"Michaelhouse",  runs:0,  wkts:0, date:"2025-01-18", result:"W"},
      {opp:"DHS",           runs:0,  wkts:0, date:"2025-01-25", result:"W"},
    ],
  },
  { id:"p6",  name:"Aiden Petersen",     team:"U19A", school:"HIL", role:"BOWL", batHand:"R", bowlArm:"R", bowlStyle:"S",  age:18, fitness:"fit",
    avg:14.2, sr:78.4,  wkts:19, econ:5.9,  form:[1,2,3,1,2,2,3,1],
    born:"2006-06-14", hometown:"Ballito, KZN", houseAtSchool:"Allott House",
    height:"183cm", weight:"78kg", battingPos:10,
    bio:"Miserly right-arm spin bowler. Best economy in the squad (5.9). Dangerous in the middle overs. Consistent line and length.",
    careerTotals:{ innings:36, runs:196, hs:22, fifties:0, hundreds:0, balls:2160, wktsTotal:54, maidens:18 },
    seasonForm:[
      {opp:"Michaelhouse",  runs:4,  wkts:2, date:"2025-01-18", result:"W"},
      {opp:"DHS",           runs:8,  wkts:3, date:"2025-01-25", result:"W"},
      {opp:"Kearsney",      runs:0,  wkts:2, date:"2025-02-01", result:"W"},
      {opp:"Glenwood",      runs:2,  wkts:4, date:"2025-02-15", result:"W"},
      {opp:"Westville",     runs:0,  wkts:3, date:"2025-02-22", result:"W"},
    ],
    vsOpponents:{ Michaelhouse:{P:4,wkts:8,avg:21.3}, DHS:{P:3,wkts:7,avg:18.9}, Kearsney:{P:4,wkts:9,avg:17.2} },
  },
  { id:"p7",  name:"Dylan Fortuin",      team:"U19A", school:"HIL", role:"ALL",  batHand:"L", bowlArm:"R", bowlStyle:"F",  age:17, fitness:"fit",
    avg:26.5, sr:128.3, wkts:11, econ:7.8,  form:[3,4,2,5,3,4,2,3],
    born:"2007-01-22", hometown:"Hilton, KZN", houseAtSchool:"Smith House",
    height:"181cm", weight:"75kg", battingPos:6,
    bio:"Left-hand middle-order bat and right-arm medium pace. Excellent fielder — 8 catches this season. School's most athletic cricketer.",
    careerTotals:{ innings:36, runs:788, hs:74, fifties:4, hundreds:0, balls:1440, wktsTotal:32, maidens:3 },
    seasonForm:[
      {opp:"Michaelhouse",  runs:31, wkts:2, date:"2025-01-18", result:"W"},
      {opp:"DHS",           runs:48, wkts:1, date:"2025-01-25", result:"W"},
      {opp:"Kearsney",      runs:22, wkts:2, date:"2025-02-01", result:"W"},
      {opp:"Maritzburg Col",runs:54, wkts:0, date:"2025-02-08", result:"L"},
      {opp:"Glenwood",      runs:38, wkts:2, date:"2025-02-15", result:"W"},
      {opp:"Westville",     runs:27, wkts:1, date:"2025-02-22", result:"W"},
    ],
  },
  { id:"p8",  name:"Connor Walsh",       team:"U19A", school:"HIL", role:"BAT",  batHand:"R", bowlArm:"R", bowlStyle:"M",  age:18, fitness:"rehab",
    avg:38.7, sr:125.1, wkts:0,  econ:0,   form:[0,0,2,3,4,5,3,4],
    born:"2006-11-08", hometown:"Ballito, KZN", houseAtSchool:"School House",
    height:"179cm", weight:"73kg", battingPos:4,
    bio:"Middle-order anchor. Returning from shoulder impingement. Excellent record when fit — averaging 38.7 this season.",
    careerTotals:{ innings:34, runs:1102, hs:98, fifties:9, hundreds:0, balls:0, wktsTotal:0, maidens:0 },
    seasonForm:[
      {opp:"Glenwood",      runs:41, wkts:0, date:"2025-02-15", result:"W"},
      {opp:"Westville",     runs:55, wkts:0, date:"2025-02-22", result:"W"},
    ],
  },
  // ── HILTON U15A ──
  { id:"p9",  name:"Sam Petersen",       team:"U15A", school:"HIL", role:"BAT",  batHand:"R", bowlArm:"R", bowlStyle:"M",  age:15, fitness:"fit",
    avg:42.1, sr:131.2, wkts:4,  econ:7.9,  cap:"c",  form:[5,4,3,6,4,5,3,4],
    born:"2009-07-11", hometown:"Hilton, KZN", houseAtSchool:"School House",
    height:"171cm", weight:"62kg", battingPos:1,
    bio:"U15A captain. Compact opener with elegant technique. Provincial trials U15 KZN 2024. Excellent future prospect.",
    careerTotals:{ innings:24, runs:882, hs:94, fifties:7, hundreds:0, balls:180, wktsTotal:4, maidens:0 },
    seasonForm:[
      {opp:"Maritzburg Col",runs:45, wkts:0, date:"2025-01-20", result:"L"},
      {opp:"Kearsney",      runs:78, wkts:1, date:"2025-02-10", result:"W"},
      {opp:"Westville U15", runs:62, wkts:0, date:"2025-02-24", result:"W"},
    ],
  },
  { id:"p10", name:"Jude Mthembu",       team:"U15A", school:"HIL", role:"BOWL", batHand:"R", bowlArm:"R", bowlStyle:"F",  age:14, fitness:"fit",
    avg:12.1, sr:88.2,  wkts:18, econ:6.2,  form:[1,2,2,3,1,2,3,1],
    born:"2010-02-28", hometown:"Pietermaritzburg, KZN", houseAtSchool:"Day Boys",
    height:"168cm", weight:"58kg", battingPos:10,
    bio:"Tall right-arm fast bowler for his age. 18 wickets at 6.2 economy. Key weapon for U15A. Significant pace prospect.",
    careerTotals:{ innings:22, runs:148, hs:18, fifties:0, hundreds:0, balls:1320, wktsTotal:48, maidens:9 },
    seasonForm:[
      {opp:"Maritzburg Col",runs:4, wkts:2, date:"2025-01-20", result:"L"},
      {opp:"Kearsney",      runs:8, wkts:3, date:"2025-02-10", result:"W"},
      {opp:"Westville U15", runs:0, wkts:4, date:"2025-02-24", result:"W"},
    ],
  },
  { id:"p11", name:"Luke van der Berg",  team:"U15A", school:"HIL", role:"ALL",  batHand:"R", bowlArm:"L", bowlStyle:"S",  age:15, fitness:"fit",
    avg:24.3, sr:115.8, wkts:12, econ:6.5,  form:[3,2,4,3,2,4,3,2],
    born:"2009-05-19", hometown:"Hilton, KZN", houseAtSchool:"Allott House",
    height:"172cm", weight:"64kg", battingPos:4,
    bio:"Left-arm orthodox spinner and solid right-hand bat. Consistent performer. Reads conditions well for his age.",
    careerTotals:{ innings:22, runs:486, hs:58, fifties:2, hundreds:0, balls:960, wktsTotal:32, maidens:8 },
    seasonForm:[
      {opp:"Maritzburg Col",runs:28, wkts:1, date:"2025-01-20", result:"L"},
      {opp:"Kearsney",      runs:41, wkts:2, date:"2025-02-10", result:"W"},
      {opp:"Westville U15", runs:34, wkts:2, date:"2025-02-24", result:"W"},
    ],
  },
  { id:"p12", name:"Sipho Dlamini",      team:"U15A", school:"HIL", role:"WK",   batHand:"L", bowlArm:"R", bowlStyle:"M",  age:15, fitness:"fit",
    avg:19.8, sr:102.4, wkts:0,  econ:0,   form:[2,3,1,2,4,2,3,2],
    born:"2009-09-02", hometown:"Howick, KZN", houseAtSchool:"Smith House",
    height:"166cm", weight:"59kg", battingPos:6,
    bio:"Left-hand wicket-keeper bat. Strong lower-order contributor. Quick hands behind the stumps.",
    careerTotals:{ innings:21, runs:376, hs:45, fifties:1, hundreds:0, stumpings:12, catches:24 },
    seasonForm:[
      {opp:"Maritzburg Col",runs:18, wkts:0, date:"2025-01-20", result:"L"},
      {opp:"Kearsney",      runs:22, wkts:0, date:"2025-02-10", result:"W"},
      {opp:"Westville U15", runs:15, wkts:0, date:"2025-02-24", result:"W"},
    ],
  },
  { id:"p13", name:"Oliver Basson",      team:"U15A", school:"HIL", role:"BAT",  batHand:"R", bowlArm:"R", bowlStyle:"M",  age:14, fitness:"injured",
    avg:17.5, sr:98.1,  wkts:1,  econ:9.2,  form:[0,0,0,1,0,0,0,0],
    born:"2010-12-14", hometown:"Hilton, KZN", houseAtSchool:"Smith House",
    height:"163cm", weight:"55kg", battingPos:3,
    bio:"Young top-order bat currently out with a finger fracture. Strong season prior to injury.",
    careerTotals:{ innings:18, runs:298, hs:44, fifties:1, hundreds:0 },
    seasonForm:[],
  },
  // ── HILTON U13A ──
  { id:"p14", name:"Felix Joubert",      team:"U13A", school:"HIL", role:"BAT",  batHand:"R", bowlArm:"R", bowlStyle:"M",  age:13, fitness:"fit",
    avg:31.2, sr:121.5, wkts:2,  econ:8.4,  cap:"c",  form:[3,4,2,4,3,5,4,3],
    born:"2011-08-20", hometown:"Hilton, KZN", houseAtSchool:"School House",
    height:"158cm", weight:"50kg", battingPos:1,
    bio:"U13A captain. Mature opener for his age with excellent patience. Top run-scorer in U13 KZN festival 2024.",
    careerTotals:{ innings:16, runs:468, hs:72, fifties:3, hundreds:0 },
    seasonForm:[
      {opp:"Michaelhouse Prep",runs:44,wkts:0, date:dateStr(addDays(today,2)), result:null},
    ],
  },
  { id:"p15", name:"Aryan Patel",        team:"U13A", school:"HIL", role:"ALL",  batHand:"R", bowlArm:"R", bowlStyle:"S",  age:12, fitness:"fit",
    avg:22.1, sr:118.2, wkts:9,  econ:6.9,  form:[2,3,3,2,4,2,3,3],
    born:"2012-03-07", hometown:"Durban, KZN", houseAtSchool:"Day Boys",
    height:"154cm", weight:"47kg", battingPos:4,
    bio:"Leg-spin allrounder. Youngest in the squad at 12. Shows remarkable maturity and skill for his age.",
    careerTotals:{ innings:14, runs:286, hs:48, fifties:1, hundreds:0, balls:840, wktsTotal:24, maidens:3 },
    seasonForm:[],
  },
  { id:"p16", name:"Kai Mostert",        team:"U13A", school:"HIL", role:"BOWL", batHand:"L", bowlArm:"L", bowlStyle:"F",  age:13, fitness:"fit",
    avg:9.8,  sr:72.1,  wkts:14, econ:5.8,  form:[1,2,1,2,2,1,2,2],
    born:"2011-10-31", hometown:"Hilton, KZN", houseAtSchool:"Allott House",
    height:"161cm", weight:"52kg", battingPos:11,
    bio:"Left-arm fast bowler. Leading wicket-taker in U13 division. Has taken 3 five-wicket hauls this season.",
    careerTotals:{ innings:14, runs:112, hs:14, fifties:0, hundreds:0, balls:720, wktsTotal:38, maidens:7 },
    seasonForm:[],
  },
  { id:"p17", name:"Nathan Botha",       team:"U13A", school:"HIL", role:"BAT",  batHand:"R", bowlArm:"R", bowlStyle:"M",  age:12, fitness:"fit",
    avg:18.4, sr:109.3, wkts:0,  econ:0,   form:[2,1,3,2,3,1,2,3],
    born:"2012-07-14", hometown:"Pietermaritzburg, KZN", houseAtSchool:"Smith House",
    height:"152cm", weight:"45kg", battingPos:3,
    bio:"Technically sound right-hand bat. Excellent square of the wicket. Strong candidate for U15 squad next year.",
    careerTotals:{ innings:14, runs:242, hs:41, fifties:0, hundreds:0 },
    seasonForm:[],
  },
  { id:"p18", name:"Ruan Jacobs",        team:"U13A", school:"HIL", role:"WK",   batHand:"R", bowlArm:"R", bowlStyle:"M",  age:13, fitness:"fit",
    avg:15.2, sr:95.8,  wkts:0,  econ:0,   form:[2,2,1,3,2,2,1,2],
    born:"2011-12-04", hometown:"Hilton, KZN", houseAtSchool:"Day Boys",
    height:"156cm", weight:"48kg", battingPos:7,
    bio:"Keeper-bat. Quick and enthusiastic behind the stumps. Developing his batting under Coach Naidoo.",
    careerTotals:{ innings:14, runs:198, hs:32, fifties:0, hundreds:0, stumpings:8, catches:16 },
    seasonForm:[],
  },
  // ── WESTVILLE BOYS' HIGH SCHOOL — U19A ──
  { id:"w1",  name:"Jordan Naidoo",      team:"U19A", school:"WES", role:"BAT",  batHand:"R", bowlArm:"R", bowlStyle:"M",  age:18, fitness:"fit",
    avg:41.8, sr:128.4, wkts:0,  econ:0,   cap:"c",  form:[5,3,4,6,2,4,5,3],
    born:"2006-05-14", hometown:"Westville, KZN", houseAtSchool:"Castle House",
    height:"180cm", weight:"74kg", battingPos:1,
    bio:"Westville captain. Elegant right-hand opener. KZN U19 squad 2024. One of the top schoolboy batsmen on the KZN coast.",
    careerTotals:{ innings:40, runs:1628, hs:108, fifties:12, hundreds:1, wktsTotal:0 },
    seasonForm:[
      {opp:"Glenwood",      runs:88, wkts:0, date:"2025-01-15", result:"W"},
      {opp:"DHS",           runs:52, wkts:0, date:"2025-01-22", result:"W"},
      {opp:"Hilton",        runs:24, wkts:0, date:"2025-02-22", result:"L"},
    ],
  },
  { id:"w2",  name:"Keenan Govender",    team:"U19A", school:"WES", role:"BOWL", batHand:"R", bowlArm:"R", bowlStyle:"F",  age:18, fitness:"fit",
    avg:16.2, sr:90.1,  wkts:21, econ:7.1,  form:[2,1,3,2,1,3,2,1],
    born:"2006-09-08", hometown:"Westville, KZN", houseAtSchool:"Towers House",
    height:"185cm", weight:"80kg", battingPos:8,
    bio:"Right-arm pace. Quick and aggressive. 21 wickets at 7.1 makes him the coastal schools' most economical quick.",
    careerTotals:{ innings:36, runs:284, hs:28, fifties:0, hundreds:0, balls:2520, wktsTotal:58, maidens:10 },
    seasonForm:[
      {opp:"Glenwood",      runs:4,  wkts:4, date:"2025-01-15", result:"W"},
      {opp:"DHS",           runs:0,  wkts:3, date:"2025-01-22", result:"W"},
      {opp:"Hilton",        runs:8,  wkts:2, date:"2025-02-22", result:"L"},
    ],
  },
  { id:"w3",  name:"Sipho Zwane",        team:"U19A", school:"WES", role:"ALL",  batHand:"R", bowlArm:"R", bowlStyle:"S",  age:17, fitness:"fit",
    avg:28.4, sr:122.3, wkts:13, econ:7.4,  form:[3,4,2,3,4,2,3,4],
    born:"2007-03-21", hometown:"Pinetown, KZN", houseAtSchool:"Castle House",
    height:"176cm", weight:"71kg", battingPos:5,
    bio:"Versatile allrounder. Off-spin bowling and aggressive middle-order batting. Key to Westville's recent rise up the Coastal table.",
    careerTotals:{ innings:34, runs:852, hs:79, fifties:5, hundreds:0, balls:1680, wktsTotal:38, maidens:6 },
    seasonForm:[
      {opp:"Glenwood",      runs:55, wkts:2, date:"2025-01-15", result:"W"},
      {opp:"DHS",           runs:38, wkts:1, date:"2025-01-22", result:"W"},
      {opp:"Hilton",        runs:22, wkts:2, date:"2025-02-22", result:"L"},
    ],
  },
  // ── WESTVILLE U15A ──
  { id:"w4",  name:"Dhilan Pillay",      team:"U15A", school:"WES", role:"BAT",  batHand:"L", bowlArm:"R", bowlStyle:"M",  age:15, fitness:"fit",
    avg:34.2, sr:118.6, wkts:2,  econ:8.1,  cap:"c",  form:[4,3,5,2,4,3,4,3],
    born:"2009-11-14", hometown:"Westville, KZN", houseAtSchool:"Towers House",
    height:"168cm", weight:"61kg", battingPos:1,
    bio:"Left-hand opener. U15A captain. Compact technique and excellent temperament. KZN U15 provincial camp 2024.",
    careerTotals:{ innings:22, runs:716, hs:82, fifties:6, hundreds:0 },
    seasonForm:[
      {opp:"Hilton U15",    runs:44, wkts:0, date:"2025-02-24", result:"L"},
    ],
  },
  { id:"w5",  name:"Marco Ferreira",     team:"U15A", school:"WES", role:"BOWL", batHand:"R", bowlArm:"R", bowlStyle:"F",  age:14, fitness:"fit",
    avg:11.4, sr:82.3,  wkts:16, econ:6.8,  form:[2,3,1,2,3,2,1,3],
    born:"2010-06-30", hometown:"Westville, KZN", houseAtSchool:"Castle House",
    height:"170cm", weight:"63kg", battingPos:9,
    bio:"Tall right-arm seamer. Awkward action generates good bounce. Leading U15 Coastal wicket-taker.",
    careerTotals:{ innings:20, runs:162, hs:22, fifties:0, hundreds:0, balls:1200, wktsTotal:44, maidens:8 },
    seasonForm:[
      {opp:"Hilton U15",    runs:2,  wkts:3, date:"2025-02-24", result:"L"},
    ],
  },
];

const COACHES = [
  {
    id:"c1", name:"Mr Craig Hendricks",  role:"Head Coach",      team:"U19A",
    qual:"Level 3 CSA", phone:"+27 83 421 1234", email:"c.hendricks@hilton.co.za",
    born:"1978-03-14", hometown:"Pietermaritzburg, KZN",
    height:"178cm", photo:"CH",
    bio:"Craig brings 18 years of coaching experience to Hilton College. Former KZN Inland first-class player (2000–2008, 42 matches). Appointed Head Coach U19A in 2018. Under his tenure, Hilton U19A have won 3 KZN Midlands league titles.",
    qualifications:["Level 3 CSA Coach","Strength & Conditioning Certificate (UP)","BokSmart Certified","Mental Performance Coaching (WBSC)"],
    coachingCareer:[
      {year:"2006–2012", role:"Assistant Coach", team:"Midlands Colts CC", level:"Club"},
      {year:"2012–2018", role:"Head Coach",      team:"Hilton U15A",        level:"School"},
      {year:"2018–now",  role:"Head Coach",      team:"Hilton U19A",        level:"School"},
    ],
    stats:{ matchesCoached:156, wins:112, losses:38, draws:6, winRate:71.8, playersPromoted:14 },
    specialisation:"Top-order batting, batting match plans, opposition analysis",
    availability:"Mon–Fri full time + Saturday fixtures",
    notes:"Runs weekly video analysis sessions. Keen on using data to shape training.",
  },
  {
    id:"c2", name:"Mr Dean Abrahams",    role:"Assistant Coach",  team:"U19A",
    qual:"Level 2 CSA", phone:"+27 72 334 5678", email:"d.abrahams@hilton.co.za",
    born:"1985-11-02", hometown:"Durban, KZN",
    height:"183cm", photo:"DA",
    bio:"Former KZN Coastal club cricketer. Specialist bowling coach with a passion for spin. Has produced 4 provincial spin bowlers from Hilton.",
    qualifications:["Level 2 CSA Coach","Spin Bowling Specialist (SA Cricket)","Strength & Conditioning Level 1"],
    coachingCareer:[
      {year:"2010–2015", role:"Bowling Coach", team:"Westville CC",  level:"Club"},
      {year:"2016–now",  role:"Asst Coach",    team:"Hilton U19A",   level:"School"},
    ],
    stats:{ matchesCoached:98, wins:71, losses:24, draws:3, winRate:72.4, playersPromoted:6 },
    specialisation:"Spin bowling development, death bowling, fielding drills",
    availability:"Tue–Sat",
    notes:"Runs the popular spin bowling clinics on Saturday mornings.",
  },
  {
    id:"c3", name:"Mr Tayla Fortuin",    role:"Head Coach",      team:"U15A",
    qual:"Level 2 CSA", phone:"+27 79 881 2345", email:"t.fortuin@hilton.co.za",
    born:"1990-07-25", hometown:"Howick, KZN",
    height:"175cm", photo:"TF",
    bio:"Former Hilton College captain (2008). Returned as U15A coach in 2020. Focus on long-term player development and building correct habits early.",
    qualifications:["Level 2 CSA Coach","Youth Cricket Facilitation (CSA)","First Aid Level 2"],
    coachingCareer:[
      {year:"2015–2020", role:"U13 Coach",   team:"Hilton U13A", level:"School"},
      {year:"2020–now",  role:"Head Coach",  team:"Hilton U15A", level:"School"},
    ],
    stats:{ matchesCoached:82, wins:52, losses:28, draws:2, winRate:63.4, playersPromoted:8 },
    specialisation:"Batting technique fundamentals, age-appropriate periodisation",
    availability:"Mon–Sat",
    notes:"Strong record of developing U15 players who go on to succeed in U19.",
  },
  {
    id:"c4", name:"Ms Priya Naidoo",     role:"Head Coach",      team:"U13A",
    qual:"Level 1 CSA", phone:"+27 81 556 7890", email:"p.naidoo@hilton.co.za",
    born:"1994-02-18", hometown:"Pietermaritzburg, KZN",
    height:"165cm", photo:"PN",
    bio:"First female coach in Hilton's cricket programme. Former KZN Women's captain. Creates a positive, skill-building environment for the youngest players.",
    qualifications:["Level 1 CSA Coach","Level 2 CSA (in progress)","Sport Psychology Workshop (UKZN)"],
    coachingCareer:[
      {year:"2018–2022", role:"Player/Coach",  team:"KZN Women's XI",   level:"Provincial"},
      {year:"2022–now",  role:"Head Coach",    team:"Hilton U13A",       level:"School"},
    ],
    stats:{ matchesCoached:44, wins:28, losses:14, draws:2, winRate:63.6, playersPromoted:5 },
    specialisation:"Game enjoyment, basic techniques, building confidence",
    availability:"Mon–Fri afternoons + Saturday",
    notes:"Outstanding relationship with parents. Brings high energy to every session.",
  },
];

// ── STAFF PROFILES ────────────────────────────────────
const STAFF = [
  {
    id:"st1", role:"scorer", name:"Mr Brian Wessels",
    age:54, phone:"+27 83 774 2210", email:"bwessels@hilton.co.za",
    photo:"BW", active:true,
    qualifications:["CSA Certified Scorer (Level 2)","ECB Scoring Award"],
    experience:"22 years. CSA provincial scorer 2008–2015. Hilton 1st team scorer since 2012.",
    teamsAssigned:["U19A","U15A"],
    scoringSystem:"DRS Pro + manual backup",
    equipment:["HP Laptop","Dell Backup tablet","DRS Pro licence","Printed scorebooks"],
    languages:["English","Afrikaans"],
    availability:"All home fixtures + selected away",
    notes:"Extremely reliable. Has scored in 3 Coca-Cola tournaments.",
  },
  {
    id:"st2", role:"scorer", name:"Ms Zanele Dlamini",
    age:29, phone:"+27 71 443 9981", email:"zdlamini@hilton.co.za",
    photo:"ZD", active:true,
    qualifications:["CSA Certified Scorer (Level 1)"],
    experience:"4 years. Joined Hilton 2021. Previously scored for Howick CC.",
    teamsAssigned:["U13A"],
    scoringSystem:"CricHQ mobile",
    equipment:["iPad","CricHQ subscription","Printed backup book"],
    languages:["English","Zulu"],
    availability:"All fixtures when available",
    notes:"Excellent with digital tools. Learning DRS Pro for 2025 season.",
  },
  {
    id:"st3", role:"medical", name:"Dr Siphamandla Khumalo",
    age:38, phone:"+27 82 331 0045", email:"skhumalo@hilton.co.za",
    photo:"SK", active:true,
    qualifications:["MBChB (UKZN)","Diploma in Sports Medicine","BokSmart Certified","ACLS Provider"],
    experience:"10 years sports medicine. UKZN Impi match-day doctor. Appointed Hilton College Sports Physician 2020.",
    specialisation:"Sports injuries, concussion protocol, return-to-play management",
    registeredWith:"HPCSA · Sports Medicine SA",
    emergencyEquipment:["AED Defibrillator","O2 cylinder","Trauma bag","Cervical collars","Splinting kit","Medications bag"],
    availability:"All match days. On-call for training.",
    concussionProtocol:"SCAT5 + 48h stand-down minimum. Return-to-play in 6 stages.",
    notes:"Handles all concussion assessments in person. Parent notification within 1 hour of any incident.",
  },
  {
    id:"st4", role:"medical", name:"Sr Nombuso Dube",
    age:44, phone:"+27 79 662 1123", email:"ndube@hilton.co.za",
    photo:"ND", active:true,
    qualifications:["B.Nursing (DUT)","Sports First Aid Level 3","Massage Therapy Certificate"],
    experience:"18 years nursing. School nurse at Hilton since 2016. Match-day physio support.",
    specialisation:"Strapping & taping, soft-tissue treatment, first aid",
    registeredWith:"SANC",
    emergencyEquipment:["First aid kit","Strapping supplies","Ice packs","Ibuprofen gel"],
    availability:"All home matches. Clinic hrs Mon–Fri 08:00–17:00.",
    notes:"Primary contact for day-to-day player welfare. Manages sick-bay records.",
  },
  {
    id:"st5", role:"driver", name:"Mr Themba Nxumalo",
    age:51, phone:"+27 76 881 5533", email:"tnxumalo@hilton.co.za",
    photo:"TN", active:true,
    qualifications:["PrDP (Passengers)","Code 10 Driver's Licence","First Aid Level 1"],
    experience:"14 years at Hilton College. Senior transport driver. 380 000 km incident-free.",
    vehicles:[
      { reg:"KZN 482 GP", type:"Quantum 22-seater", capacity:22, condition:"Excellent", nextService:dateStr(addDays(new Date(),18)) },
      { reg:"KZN 119 KP", type:"Quantum 14-seater", capacity:14, condition:"Good",      nextService:dateStr(addDays(new Date(),45)) },
    ],
    regularRoutes:["Hilton → Michaelhouse","Hilton → Durban (DHS, Glenwood, Westville)","Hilton → Pietermaritzburg (College)"],
    availability:"All school days + Saturday fixtures",
    notes:"Excellent safety record. Passengers must be seated and belted before departure.",
  },
  {
    id:"st6", role:"driver", name:"Mr Patrick Sithole",
    age:46, phone:"+27 83 224 7712", email:"psithole@hilton.co.za",
    photo:"PS", active:true,
    qualifications:["PrDP (Passengers)","Code 10 Driver's Licence"],
    experience:"7 years at Hilton. Previously taxi operator (10 years). Clean record.",
    vehicles:[
      { reg:"KZN 771 MP", type:"Toyota Coaster 30-seater", capacity:30, condition:"Good", nextService:dateStr(addDays(new Date(),12)) },
    ],
    regularRoutes:["Hilton → Kearsney","Hilton → Westville/Clifton/Northlands (Durban coastal)","Hilton → Howick area"],
    availability:"Full time",
    notes:"Used primarily for longer trips. Excellent with the boys.",
  },
  {
    id:"st7", role:"groundskeeper", name:"Mr Ernest Mzimba",
    age:58, phone:"+27 72 445 0087", email:"emzimba@hilton.co.za",
    photo:"EM", active:true,
    qualifications:["Turfgrass Management Certificate (UKZN)","Groundsmanship Level 2 (CSA)","Irrigation Systems Certificate"],
    experience:"26 years. Has prepared pitches for 3 national U19 trials at Hilton.",
    groundsAssigned:["g1","g2"],
    equipment:["Toro ride-on mower","Kubota tractor + roller","Scarifier","Sarel roller","Irrigation controller","Pitch covers (2 sets)"],
    pitchPreparation:"Starts preparation 5 days before match day. Uses heavy roller day 4–5.",
    speciality:"Flat, true Midlands surfaces. Known for excellent bounce consistency.",
    notes:"Consults weather forecast daily. Covers pitches when thunderstorm risk >40%.",
  },
  {
    id:"st8", role:"groundskeeper", name:"Mr Sipho Hadebe",
    age:34, phone:"+27 81 990 3345", email:"shadebe@hilton.co.za",
    photo:"SH", active:true,
    qualifications:["Horticulture Certificate (Cedara)","Groundsmanship Level 1 (CSA)"],
    experience:"6 years. Ernest's assistant. Manages outfield maintenance and net surfaces.",
    groundsAssigned:["g3","g4","g5"],
    equipment:["Honda walk-behind mower","Hand roller","Stump sets × 4","Boundary markers","Sight screens × 2"],
    speciality:"Outfield preparation and net maintenance",
    notes:"Takes over primary prep duties when Ernest on leave.",
  },
  // Sportsmaster
  {
    id:"st9", role:"sportsmaster", name:"Mr Graham Sutherland",
    age:48, phone:"+27 82 441 7721", email:"gsutherland@hilton.co.za",
    photo:"GS", active:true,
    qualifications:["BSc Sports Science (UKZN)","Level 3 CSA Coach","Athletics SA Officials Badge"],
    experience:"22 years. Former Natal B cricketer. Appointed Hilton Sportsmaster 2014. Oversees 8 sports codes.",
    sportsOverseen:["Cricket","Rugby","Hockey","Tennis","Athletics","Swimming","Squash","Rowing"],
    notes:"Coordinates all inter-school fixtures and facilities allocation. Monthly budget reporting to Principal.",
  },
  // Coaching Assistants
  {
    id:"st10", role:"assistant", name:"Mr Siyanda Maphumulo",
    age:26, phone:"+27 73 882 0014", email:"smaphumulo@hilton.co.za",
    photo:"SM", active:true,
    qualifications:["Level 1 CSA Coach","BA Sports Management (DUT)"],
    experience:"2 years. Assists Craig Hendricks with U19A. Specialist fielding and fitness.",
    teamsAssigned:["U19A"],
    specialisation:"Fielding drills, fitness conditioning, video analysis",
    notes:"Manages the squad WhatsApp and training attendance records.",
  },
  {
    id:"st11", role:"assistant", name:"Mr Luyanda Dube",
    age:23, phone:"+27 71 334 5512", email:"ldube@hilton.co.za",
    photo:"LD", active:true,
    qualifications:["Level 1 CSA Coach","BSc Sport Science (UKZN, in progress)"],
    experience:"1 year. Assists Tayla Fortuin with U15A. Focus on batting coaching.",
    teamsAssigned:["U15A"],
    specialisation:"Batting technique, throw-downs, opposition video scouting",
    notes:"Former Hilton College pupil (2019). Excellent rapport with the boys.",
  },
];

const USERS_INITIAL = [
  { id:"u1",  name:"Admin User",              role:"superadmin",    email:"admin@hilton.co.za",          player:null,  staffId:null,  coachId:null,  lastLogin:"Today 08:14",  status:"active"   },
  { id:"u2",  name:"Craig Hendricks",         role:"coach",         email:"c.hendricks@hilton.co.za",    player:null,  staffId:null,  coachId:"c1",  lastLogin:"Today 07:55",  status:"active"   },
  { id:"u3",  name:"James Whitfield",         role:"player",        email:"james@hilton.co.za",          player:"p1",  staffId:null,  coachId:null,  lastLogin:"Yesterday",    status:"active"   },
  { id:"u4",  name:"Helen Whitfield",         role:"parent",        email:"helen.w@gmail.com",           player:"p1",  staffId:null,  coachId:null,  lastLogin:"3 days ago",   status:"active"   },
  { id:"u5",  name:"Spectator View",          role:"spectator",     email:"fan@example.com",             player:null,  staffId:null,  coachId:null,  lastLogin:"1 week ago",   status:"active"   },
  { id:"u6",  name:"Brian Wessels",           role:"scorer",        email:"bwessels@hilton.co.za",       player:null,  staffId:"st1", coachId:null,  lastLogin:"Today 09:00",  status:"active"   },
  { id:"u7",  name:"Dr Siphamandla Khumalo",  role:"medical",       email:"skhumalo@hilton.co.za",       player:null,  staffId:"st3", coachId:null,  lastLogin:"Yesterday",    status:"active"   },
  { id:"u8",  name:"Themba Nxumalo",          role:"driver",        email:"tnxumalo@hilton.co.za",       player:null,  staffId:"st5", coachId:null,  lastLogin:"2 days ago",   status:"active"   },
  { id:"u9",  name:"Ernest Mzimba",           role:"groundskeeper", email:"emzimba@hilton.co.za",        player:null,  staffId:"st7", coachId:null,  lastLogin:"Today 06:30",  status:"active"   },
  { id:"u10", name:"Luca De Villiers",        role:"player",        email:"luca@hilton.co.za",           player:"p2",  staffId:null,  coachId:null,  lastLogin:"Yesterday",    status:"active"   },
  { id:"u11", name:"Dean Abrahams",           role:"coach",         email:"d.abrahams@hilton.co.za",     player:null,  staffId:null,  coachId:"c2",  lastLogin:"Today 08:00",  status:"active"   },
  { id:"u13", name:"Graham Sutherland",        role:"sportsmaster",  email:"gsutherland@hilton.co.za",    player:null,  staffId:"st9", coachId:null,  lastLogin:"Today 07:30",  status:"active"   },
  { id:"u14", name:"Siyanda Maphumulo",         role:"assistant",     email:"smaphumulo@hilton.co.za",     player:null,  staffId:"st10",coachId:null,  lastLogin:"Today 08:45",  status:"active"   },
  { id:"u15", name:"Luyanda Dube",              role:"assistant",     email:"ldube@hilton.co.za",          player:null,  staffId:"st11",coachId:null,  lastLogin:"Yesterday",    status:"active"   },
  { id:"u12", name:"Priya Naidoo",            role:"coach",         email:"p.naidoo@hilton.co.za",       player:null,  staffId:null,  coachId:"c4",  lastLogin:"Yesterday",    status:"active"   },
];

const WEATHER = {
  m1: { condition:"Clear",       tempC:24, humidity:52, windKph:14, windDir:"SW", uvIndex:8,  rainChancePct:5,  forecast:"Fine morning. Clear skies. Low DLS risk.", icon:"☀️",  playable:true  },
  m2: { condition:"Overcast",    tempC:19, humidity:74, windKph:22, windDir:"E",  uvIndex:4,  rainChancePct:40, forecast:"Cloud building from east. Light showers possible mid-afternoon.", icon:"🌥️", playable:true  },
  m3: { condition:"Overcast",    tempC:22, humidity:70, windKph:15, windDir:"NE", uvIndex:4,  rainChancePct:30, forecast:"Earlier cell cleared to the south. Covers off, play underway. Low DLS risk.", icon:"🌥️", playable:true  },
  m4: { condition:"Partly Cloudy",tempC:22,humidity:60, windKph:16, windDir:"SW", uvIndex:7,  rainChancePct:20, forecast:"Pleasant Midlands morning. Isolated cloud. Excellent conditions.", icon:"⛅", playable:true  },
  m5: { condition:"Sunny",       tempC:26, humidity:45, windKph:10, windDir:"S",  uvIndex:9,  rainChancePct:8,  forecast:"Clear sunny day. High UV. Sunscreen recommended.", icon:"☀️",  playable:true  },
  m6: { condition:"Drizzle",     tempC:17, humidity:82, windKph:18, windDir:"NE", uvIndex:3,  rainChancePct:55, forecast:"Persistent drizzle from coastal front. Toss delayed.", icon:"🌧️",  playable:false },
  m7: { condition:"Clear",       tempC:25, humidity:50, windKph:12, windDir:"SW", uvIndex:8,  rainChancePct:8,  forecast:"Excellent coastal conditions. Low humidity, light winds.", icon:"☀️",  playable:true  },
  m8: { condition:"Partly Cloudy",tempC:21,humidity:65, windKph:18, windDir:"E",  uvIndex:6,  rainChancePct:25, forecast:"Morning cloud clearing by 09:30. Good afternoon conditions.", icon:"⛅", playable:true  },
};

const MATCHES = [
  { id:"m1", homeTeam:"Hilton U19A",  awayTeam:"Michaelhouse U19A",       venue:"Hilton No.1 Ground",       groundId:"g1", date:dateStr(addDays(today,-2)), result:"Hilton won by 34 runs",      status:"complete", competition:"comp1", scorecard:{home:{score:"186/6",overs:"20"},away:{score:"152/9",overs:"20"}},  scorerId:"st1" },
  { id:"m2", homeTeam:"Hilton U15A",  awayTeam:"Maritzburg College U15A",  venue:"Hilton No.2 Ground",       groundId:"g2", date:dateStr(addDays(today,-1)), result:"College won by 6 wkts",      status:"complete", competition:"comp2", scorecard:{home:{score:"134/10",overs:"18.3"},away:{score:"135/4",overs:"16.1"}}, scorerId:"st2" },
  { id:"m3", homeTeam:"Hilton U19A",  awayTeam:"Kearsney College U19A",    venue:"Hilton No.1 Ground",       groundId:"g1", date:dateStr(today),             result:"Hilton U19A batting",         status:"live",     competition:"comp1", scorecard:{home:{score:"142/3",overs:"14.2"},away:null}, scorerId:"st1" },
  { id:"m4", homeTeam:"Hilton U13A",  awayTeam:"Michaelhouse Prep U13A",   venue:"Hilton No.3 Ground",       groundId:"g3", date:dateStr(addDays(today,2)),  result:null,                         status:"upcoming", competition:"comp3", transport:{bus:false} },
  { id:"m5", homeTeam:"Hilton U19A",  awayTeam:"Durban High School U19A",  venue:"DHS Main Ground, Durban",  groundId:null, date:dateStr(addDays(today,5)),  result:null,                         status:"upcoming", competition:"comp1", transport:{bus:true,depart:"06:30",return:"18:30",driverId:"st5",vehicle:"KZN 771 MP",seats:30} },
  { id:"m6", homeTeam:"Hilton U15A",  awayTeam:"Kearsney U15A",            venue:"Kearsney College Ground",  groundId:null, date:dateStr(addDays(today,7)),  result:null,                         status:"upcoming", competition:"comp2", transport:{bus:true,depart:"07:00",return:"16:30",driverId:"st5",vehicle:"KZN 482 GP",seats:22} },
  { id:"m7", homeTeam:"Westville U19A",awayTeam:"Hilton U19A",             venue:"Westville CC Ground",      groundId:null, date:dateStr(addDays(today,-8)), result:"Hilton won by 72 runs",      status:"complete", competition:"comp1", scorecard:{home:{score:"118/10",overs:"18.2"},away:{score:"190/4",overs:"20"}}, scorerId:"st1" },
  { id:"m8", homeTeam:"Hilton U15A",  awayTeam:"Westville U15A",           venue:"Hilton No.2 Ground",       groundId:"g2", date:dateStr(addDays(today,-5)), result:"Hilton won by 8 wkts",       status:"complete", competition:"comp2", scorecard:{home:{score:"88/2",overs:"12.4"},away:{score:"85/10",overs:"17.1"}}, scorerId:"st2" },
];

const COMPETITIONS = [
  { id:"comp1", name:"KZN Midlands Schools T20 League", type:"league", format:"T20",     teams:8,  gender:"M", ageGroup:"U19", active:true,
    region:"KwaZulu-Natal", organiser:"Cricket South Africa Schools",
    table:[
      {team:"Hilton U19A",        P:6,W:5,L:1,NR:0,pts:10, nrr:+1.42},
      {team:"Michaelhouse",       P:6,W:4,L:2,NR:0,pts:8,  nrr:+0.55},
      {team:"Maritzburg College", P:6,W:3,L:3,NR:0,pts:6,  nrr:+0.12},
      {team:"Kearsney College",   P:6,W:3,L:3,NR:0,pts:6,  nrr:-0.08},
      {team:"DHS",                P:6,W:3,L:3,NR:0,pts:6,  nrr:-0.24},
      {team:"Westville Boys'",    P:6,W:2,L:4,NR:0,pts:4,  nrr:-0.68},
      {team:"Glenwood",           P:6,W:1,L:5,NR:0,pts:2,  nrr:-1.09},
    ]},
  { id:"comp2", name:"KZN Schools 50-Over Championship",type:"cup",    format:"50-over", teams:16, gender:"M", ageGroup:"U15", active:true,
    region:"KwaZulu-Natal", organiser:"Cricket South Africa Schools",
    rounds:["R16","QF","SF","Final"], currentRound:"QF",
    bracket:[
      {round:"QF", fixtures:[
        {home:"Hilton U15A",   away:"Kearsney U15A",    result:null,         status:"upcoming"},
        {home:"Maritzburg Col",away:"DHS U15",          result:null,         status:"upcoming"},
        {home:"Westville U15", away:"Glenwood U15",     result:"Westville won by 4 wkts",status:"complete"},
        {home:"Michaelhouse",  away:"Northlands U15",   result:"Michaelhouse won by 34 runs",status:"complete"},
      ]},
      {round:"SF", fixtures:[
        {home:"TBD",           away:"TBD",              result:null,         status:"pending"},
        {home:"Westville U15", away:"Michaelhouse",     result:null,         status:"pending"},
      ]},
      {round:"Final", fixtures:[
        {home:"TBD",           away:"TBD",              result:null,         status:"pending"},
      ]},
    ],
  },
  { id:"comp3", name:"KZN Junior T10 Festival",         type:"tournament",format:"T10",  teams:12, gender:"M", ageGroup:"U13", active:true,
    region:"KwaZulu-Natal", organiser:"KZN Cricket",
    table:[
      {team:"Hilton U13A",     P:3,W:2,L:1,NR:0,pts:4,nrr:+0.82},
      {team:"Kearsney U13",    P:3,W:2,L:1,NR:0,pts:4,nrr:+0.44},
      {team:"Michaelhouse Prep",P:3,W:2,L:1,NR:0,pts:4,nrr:+0.18},
      {team:"Westville U13",   P:3,W:1,L:2,NR:0,pts:2,nrr:-0.32},
    ],
  },
  { id:"comp4", name:"Hilton Inter-House T20",          type:"tournament",format:"T20",  teams:4,  gender:"M", ageGroup:"Open",active:false,
    table:[
      {team:"School House",P:3,W:3,L:0,NR:0,pts:6,nrr:+2.1},
      {team:"Allott House", P:3,W:2,L:1,NR:0,pts:4,nrr:+0.4},
      {team:"Smith House",  P:3,W:1,L:2,NR:0,pts:2,nrr:-0.8},
      {team:"Day Boys",     P:3,W:0,L:3,NR:0,pts:0,nrr:-1.7},
    ]},
];

// ── LEAGUE MANAGEMENT DATA ─────────────────────────────
const LEAGUE_TEAMS = [
  { id:"lt1", name:"Hilton U19A",       school:"HIL", color:"#003366", wins:5, points:10 },
  { id:"lt2", name:"Michaelhouse",      school:"MIC", color:"#8B0000", wins:4, points:8  },
  { id:"lt3", name:"Maritzburg College",school:"MCB", color:"#003366", wins:3, points:6  },
  { id:"lt4", name:"Kearsney College",  school:"KEA", color:"#003087", wins:3, points:6  },
  { id:"lt5", name:"DHS",               school:"DHS", color:"#006400", wins:3, points:6  },
  { id:"lt6", name:"Westville Boys'",   school:"WES", color:"#800000", wins:2, points:4  },
  { id:"lt7", name:"Glenwood",          school:"GLE", color:"#00008B", wins:1, points:2  },
];

const INJURIES = [
  { id:"i1", player:"p5",  type:"Hamstring Strain",    severity:"moderate", dateInj:dateStr(addDays(today,-14)), rtw:dateStr(addDays(today,7)),  phase:"Reconditioning", notes:"Grade 2 right hamstring. Physio 3x/week with Dr Khumalo. No running until clearance.", physio:"Dr S. Khumalo", restricted:true },
  { id:"i2", player:"p8",  type:"Shoulder Impingement",severity:"mild",     dateInj:dateStr(addDays(today,-7)),  rtw:dateStr(addDays(today,14)), phase:"Strengthening",  notes:"Bowling restriction enforced. Batting allowed. Rotator cuff programme with Sr Dube.", physio:"Sr N. Dube",    restricted:true },
  { id:"i3", player:"p13", type:"Finger Fracture",     severity:"severe",   dateInj:dateStr(addDays(today,-21)), rtw:dateStr(addDays(today,21)), phase:"Immobilisation", notes:"Ring finger right hand. Cast removed next week. Full rest from cricket.", physio:"Dr S. Khumalo", restricted:true },
  { id:"i4", player:"p2",  type:"Side Strain",         severity:"mild",     dateInj:dateStr(addDays(today,-5)),  rtw:dateStr(addDays(today,3)),  phase:"Return to bowl", notes:"Monitoring ongoing. Light bowling only — max 2 overs per session.", physio:"Sr N. Dube",    restricted:true },
  { id:"i5", player:"p4",  type:"Knee Bruising",       severity:"mild",     dateInj:dateStr(addDays(today,-3)),  rtw:dateStr(addDays(today,2)),  phase:"Cleared",        notes:"Full training. Wear knee brace for next 2 games.", physio:"Sr N. Dube",    restricted:false },
];

const TRAINING_SESSIONS = [
  { id:"t1", title:"Pre-Match Prep",       team:"U19A", date:dateStr(today),            time:"14:30", duration:90, venue:"Nets 1-3", coach:"c1", attendance:["p1","p3","p6","p7","p4"], type:"technical", drills:["Throw-downs","Bowling loads","Catching"], notes:"Focus on top-order against Kearsney pace attack." },
  { id:"t2", title:"Spin Bowling Workshop", team:"U19A", date:dateStr(addDays(today,1)), time:"14:30", duration:60, venue:"Nets 4-5", coach:"c2", attendance:["p6","p2","p3"],           type:"skills",    drills:["Line & length","Variations","Video review"], notes:"Aiden to demonstrate wrist spin." },
  { id:"t3", title:"U15A Batting Session",  team:"U15A", date:dateStr(addDays(today,1)), time:"15:00", duration:75, venue:"Nets 6-7", coach:"c3", attendance:["p9","p11","p12"],          type:"batting",   drills:["Front foot drive","Pull shot","Rotating strike"], notes:"Sam to work on leg-side play." },
  { id:"t4", title:"Fitness & Fielding",    team:"U19A", date:dateStr(addDays(today,2)), time:"06:30", duration:60, venue:"No.1 Ground", coach:"c1", attendance:["p1","p2","p3","p4","p6","p7"], type:"fitness", drills:["Reaction catches","Ground fielding","Sprints"], notes:"Pre-match sharpener before DHS away." },
  { id:"t5", title:"U13A Development",      team:"U13A", date:dateStr(addDays(today,3)), time:"14:00", duration:90, venue:"Nets 8-9", coach:"c4", attendance:["p14","p15","p16","p17","p18"], type:"technical", drills:["Basic technique","Catching","Fun games"], notes:"Developmental focus. Keep it fun." },
];

const SKILLS_MATRIX = {
  p1: { batting:{technique:85,power:78,footwork:82,running:79,temperament:88}, bowling:{accuracy:42,line:38,variations:35,pace:40,stamina:44}, fielding:{catching:80,groundwork:75,throwing:72,positioning:76}, fitness:{speed:78,agility:80,endurance:74,strength:72} },
  p2: { batting:{technique:52,power:48,footwork:50,running:55,temperament:51}, bowling:{accuracy:84,line:88,variations:76,pace:82,stamina:86}, fielding:{catching:78,groundwork:82,throwing:85,positioning:80}, fitness:{speed:82,agility:78,endurance:85,strength:80} },
  p3: { batting:{technique:74,power:82,footwork:71,running:80,temperament:75}, bowling:{accuracy:70,line:72,variations:65,pace:78,stamina:75}, fielding:{catching:85,groundwork:82,throwing:88,positioning:84}, fitness:{speed:85,agility:86,endurance:82,strength:80} },
  p9: { batting:{technique:80,power:74,footwork:78,running:82,temperament:85}, bowling:{accuracy:40,line:38,variations:32,pace:36,stamina:42}, fielding:{catching:72,groundwork:70,throwing:68,positioning:74}, fitness:{speed:76,agility:74,endurance:72,strength:68} },
};

const NOTIFICATIONS = [
  { id:"n1", type:"match",    urgency:"high",  time:"2m ago",  title:"Match Update",           body:"Hilton U19A vs Kearsney: 142/3 (14.2) — Hilton batting, in control", read:false, roles:["all"] },
  { id:"n2", type:"injury",   urgency:"high",  time:"1h ago",  title:"Injury Alert",           body:"Theo Pretorius cleared for light training from Monday",    read:false, roles:["coach","schooladmin","parent","superadmin","medical"] },
  { id:"n3", type:"weather",  urgency:"low",   time:"2h ago",  title:"🌥️ Weather Update",       body:"Earlier storm cell cleared Hilton No.1 — covers off, play resumed. Conditions good.",read:false,roles:["all"] },
  { id:"n4", type:"training", urgency:"low",   time:"3h ago",  title:"Training Reminder",      body:"U19A Pre-Match Prep today at 14:30 — Nets 1-3",           read:false, roles:["player","coach","superadmin"] },
  { id:"n5", type:"match",    urgency:"medium",time:"1d ago",  title:"Fixture Confirmed",      body:"Hilton U13A vs Michaelhouse Prep — Saturday 08:00",       read:true,  roles:["all"] },
  { id:"n6", type:"transport",urgency:"medium",time:"1d ago",  title:"Transport Confirmed",    body:"Coaster departs 06:30 for DHS away fixture. 30 seats. Driver: Themba.",read:true,roles:["parent","player","schooladmin","superadmin","driver"] },
  { id:"n7", type:"field",    urgency:"medium",time:"1d ago",  title:"Pitch Report Ready",     body:"No.1 Ground pitch report submitted by Ernest Mzimba for Kearsney match.", read:true, roles:["coach","groundskeeper","superadmin"] },
  { id:"n8", type:"skills",   urgency:"low",   time:"2d ago",  title:"Skills Review Complete", body:"Q3 assessments uploaded. View development plans in Skills module.",  read:true, roles:["player","coach","superadmin"] },
  { id:"n9", type:"system",   urgency:"low",   time:"3d ago",  title:"System Update",          body:"SCRBRD v2.2 — Profiles, League Mgmt and Westville data now live", read:true, roles:["superadmin","schooladmin"] },
];

// ── RICH FIELD & PITCH PROFILES ───────────────────────
const GROUNDS = [
  {
    id:"g1",
    name:"Hilton No.1 Ground (Main)",
    shortName:"No.1 Main",
    type:"turf",
    capacity:1200,
    lights:true, lightsLux:1800,
    available:true,
    gpsCoords:{ lat:-29.7612, lng:30.3041 },
    orientation:"NNE–SSW (147°)",
    dimensions:{ straight:72, squareLeg:64, squareOff:62, unit:"m" },
    // Surface & Pitch
    surfaceType:"Kikuyu grass outfield, clay base",
    outfieldGrade:"Excellent",
    outfieldMowHeight:"12mm",
    drainage:"Underground pipe + camber. Excellent drainage — playable within 30min of rain.",
    pitches:[
      { num:1, surface:"ProCrafter Turf",  condition:"Match-ready", bounce:"True / Consistent", cracks:"None", grass:"5mm short", moisture:"Firm — 18% moisture", spinAssist:"Low", seamMovement:"Moderate early", lastRolled:dateStr(addDays(today,-1)), preparedBy:"st7", history:"Last 5 games avg 1st innings: 178" },
      { num:2, surface:"ProCrafter Turf",  condition:"Good",        bounce:"Slightly low",      cracks:"Minor", grass:"8mm",      moisture:"18%",                 spinAssist:"Low-Med",seamMovement:"Low",      lastRolled:dateStr(addDays(today,-3)), preparedBy:"st7", history:"Last 3 games avg 1st innings: 162" },
      { num:3, surface:"ProCrafter Turf",  condition:"Resting",     bounce:"N/A",               cracks:"Resting",grass:"Growing in",moisture:"N/A",              spinAssist:"N/A",    seamMovement:"N/A",      lastRolled:null, preparedBy:"st7", history:"Rested since 2nd March" },
    ],
    facilities:{ changeRooms:true, toilets:true, scorebox:true, scoreboard:"Electronic LED", pavilion:true, medicalRoom:true, refreshments:true },
    equipment:{ sightScreens:2, stumps:6, covers:"Full pitch covers × 2", boundaries:"Plastic rope" },
    groundskeeper:"st7",
    homeTo:["U19A","1st XI trials"],
    notes:"Premier ground. Used for all 1st team fixtures and CSA Schools trials. Altitude 1 080m — ball travels further.",
    prepSchedule:"Day -5: Scarify. Day -4: Light roll. Day -3: Water. Day -2: Heavy roll. Day -1: Light roll + mow. Match day: Inspect.",
  },
  {
    id:"g2",
    name:"Hilton No.2 Ground",
    shortName:"No.2 Ground",
    type:"turf",
    capacity:500,
    lights:false,
    available:true,
    gpsCoords:{ lat:-29.7618, lng:30.3050 },
    orientation:"N–S (180°)",
    dimensions:{ straight:68, squareLeg:60, squareOff:58, unit:"m" },
    surfaceType:"Kikuyu grass outfield, clay base",
    outfieldGrade:"Good",
    outfieldMowHeight:"15mm",
    drainage:"Camber drain. Stays wet longer — 1hr post-rain delay typical.",
    pitches:[
      { num:1, surface:"ProCrafter Turf", condition:"Good",         bounce:"True",     cracks:"None",   grass:"6mm",  moisture:"19%", spinAssist:"Low",    seamMovement:"Low-Mod", lastRolled:dateStr(addDays(today,-2)), preparedBy:"st7", history:"Used for U15A fixtures" },
      { num:2, surface:"ProCrafter Turf", condition:"Maintenance",  bounce:"Uneven",   cracks:"Settling",grass:"N/A", moisture:"N/A", spinAssist:"N/A",    seamMovement:"N/A",     lastRolled:null, preparedBy:"st7", history:"Under repair" },
    ],
    facilities:{ changeRooms:true, toilets:true, scorebox:true, scoreboard:"Manual whiteboard", pavilion:false, medicalRoom:false, refreshments:false },
    equipment:{ sightScreens:2, stumps:4, covers:"Half covers × 1", boundaries:"Rope" },
    groundskeeper:"st7",
    homeTo:["U15A"],
    notes:"Used for U15A and U13A home fixtures. No pavilion — players change in school buildings.",
    prepSchedule:"Day -4: Mow. Day -3: Water + light roll. Day -1: Roll + inspect.",
  },
  {
    id:"g3",
    name:"Hilton No.3 Ground",
    shortName:"No.3 Ground",
    type:"grass",
    capacity:200,
    lights:false,
    available:true,
    gpsCoords:{ lat:-29.7630, lng:30.3062 },
    orientation:"NE–SW (120°)",
    dimensions:{ straight:62, squareLeg:54, squareOff:52, unit:"m" },
    surfaceType:"Kikuyu outfield, concrete pitch with coir mat",
    outfieldGrade:"Fair",
    outfieldMowHeight:"20mm",
    drainage:"Natural slope. Poor after heavy rain.",
    pitches:[
      { num:1, surface:"Coir Mat on Concrete", condition:"Good", bounce:"Consistent / Lively", cracks:"N/A — mat pitch", grass:"N/A", moisture:"N/A", spinAssist:"Low", seamMovement:"Low", lastRolled:"N/A", preparedBy:"st8", history:"Junior cricket only. Hard and fast." },
    ],
    facilities:{ changeRooms:false, toilets:true, scorebox:false, scoreboard:"None", pavilion:false, medicalRoom:false, refreshments:false },
    equipment:{ sightScreens:1, stumps:4, covers:"None", boundaries:"Cones" },
    groundskeeper:"st8",
    homeTo:["U13A","practice games"],
    notes:"Used exclusively for U13 and junior development cricket. Fast outfield when dry.",
    prepSchedule:"Day -1: Mow + inspect mat.",
  },
  {
    id:"g4",
    name:"Indoor Nets (Bays 1–5)",
    shortName:"Indoor Nets",
    type:"nets",
    capacity:null,
    lights:true,
    available:true,
    surfaceType:"Mondo synthetic surface",
    outfieldGrade:"N/A",
    pitches:[
      { num:1, surface:"Mondo Synthetic", condition:"Excellent", bounce:"True, slightly fast", notes:"Bay 1–2: Pace bowling" },
      { num:2, surface:"Mondo Synthetic", condition:"Good",      bounce:"True",               notes:"Bay 3–4: All-rounder" },
      { num:3, surface:"Coir Roll Mat",   condition:"Moderate",  bounce:"Slightly lower",     notes:"Bay 5: Spin practice" },
    ],
    facilities:{ changeRooms:false, toilets:false, scorebox:false, pavilion:false },
    groundskeeper:"st8",
    notes:"Air-conditioned. Booking system in place. Max 3 batters active at once.",
  },
  {
    id:"g5",
    name:"Outdoor Practice Nets (Bays 6–9)",
    shortName:"Outdoor Nets",
    type:"nets",
    capacity:null,
    lights:false,
    available:true,
    surfaceType:"Coir mat on concrete",
    outfieldGrade:"N/A",
    pitches:[
      { num:1, surface:"Coir Mat", condition:"Good",     bounce:"Fast and true",   notes:"Bay 6–7: Main practice" },
      { num:2, surface:"Coir Mat", condition:"Fair",     bounce:"Low and variable",notes:"Bay 8–9: Junior use" },
    ],
    groundskeeper:"st8",
    notes:"Covered overhead. Used for all afternoon practice sessions.",
  },
];

// ── UTILITY HELPERS ────────────────────────────────────
const px = (n) => `${n}px`;
const clr = (hex, a) => hex + Math.round(a*255).toString(16).padStart(2,"0");
const pctDays = (inj, rtw) => {
  const total = (new Date(rtw)-new Date(inj))/(1000*60*60*24);
  const done  = (today-new Date(inj))/(1000*60*60*24);
  return Math.min(100, Math.max(0, Math.round((done/total)*100)));
};
const initials = (name) => name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
const severityColor = (s) => s==="severe"?D.rose:s==="moderate"?D.orange:D.amber;
const fitnessColor  = (f) => f==="fit"?D.emerald:f==="injured"?D.rose:f==="rehab"?D.orange:D.amber;
const roleColor = (r) => ROLES[r]?.color||D.textMuted;

// ── GLOBAL CSS ──────────────────────────────────────────

// ══════════════════════════════════════════════════════
//  RBAC — single source of truth for data access.
//  Enforced client-side here; maps 1:1 to Postgres Row-Level
//  Security in production (scope → RLS predicate, deny → column
//  grants). UI nav-gating is courtesy; THIS is the security layer.
// ══════════════════════════════════════════════════════

// 6 tiers · 17 roles (reconciled — edit here and policy follows)
const RBAC_TIERS = [
  { id:"platform",    label:"Platform",          roles:["superadmin","platformsupport"] },
  { id:"leadership",  label:"School Leadership",  roles:["headmaster","sportsmaster","schooladmin","financeadmin"] },
  { id:"coaching",    label:"Coaching",           roles:["headcoach","coach","assistant","analyst"] },
  { id:"operations",  label:"Operations",         roles:["scorer","medical","groundskeeper","driver"] },
  { id:"participant", label:"Participant",        roles:["player"] },
  { id:"external",    label:"External",           roles:["parent","spectator"] },
];

// Sensitive field groups — referenced by name in the policy's `deny`.
const RBAC_FIELDS = {
  pii:      ["email","phone","born","hometown","houseAtSchool","address","guardian","height","weight"],
  clinical: ["notes","physio"],
};
const SCOPE_RANK = { none:0, own:1, team:2, school:3, all:4 };

// role → { can:actions, scope:default, only?:[resources], scopes?:{res:scope}, deny?:{res|"*":[groups]} }
const POLICY = {
  superadmin:      { can:"crud", scope:"all" },
  platformsupport: { can:"r",    scope:"all",    deny:{ "*":["pii"], injuries:["clinical"] } },
  headmaster:      { can:"ru",   scope:"school", deny:{ injuries:["clinical"] } },
  sportsmaster:    { can:"crud", scope:"school", only:["dashboard","matches","competitions","leagues","squad","players","profiles","analytics","injuries","skills","training","logistics","fields","staff","calendar","management","notifications","settings","rulebook","scoring"], deny:{ injuries:["clinical"] } },
  schooladmin:     { can:"crud", scope:"school", only:["dashboard","matches","competitions","squad","players","profiles","analytics","injuries","logistics","fields","staff","calendar","management","notifications","settings"], deny:{ injuries:["clinical"] } },
  financeadmin:    { can:"crud", scope:"school", only:["dashboard","profiles","finance","calendar","management","notifications","settings"], deny:{ profiles:["born","houseAtSchool","height","weight","guardian"] } },
  headcoach:       { can:"crud", scope:"school", only:["dashboard","matches","competitions","leagues","squad","players","profiles","analytics","skills","training","injuries","logistics","fields","calendar","management","notifications","scoring"] },
  coach:           { can:"cru",  scope:"team",   only:["dashboard","matches","squad","players","profiles","analytics","skills","training","injuries","logistics","fields","calendar","management","notifications","scoring"] },
  assistant:       { can:"ru",   scope:"team",   only:["dashboard","matches","squad","players","profiles","skills","training","injuries","calendar","notifications","scoring"], deny:{ injuries:["clinical"] } },
  analyst:         { can:"r",    scope:"school", only:["dashboard","matches","competitions","leagues","squad","players","profiles","analytics","skills","calendar"], deny:{ "*":["pii"] } },
  scorer:          { can:"cru",  scope:"team",   only:["dashboard","matches","calendar","notifications","scoring"] },
  medical:         { can:"crud", scope:"school", only:["dashboard","injuries","players","profiles","training","squad","calendar","notifications"] },
  groundskeeper:   { can:"ru",   scope:"school", only:["dashboard","fields","matches","calendar","notifications","management"] },
  driver:          { can:"r",    scope:"school", only:["dashboard","logistics","matches","calendar","notifications"] },
  player:          { can:"r",    scope:"own",    only:["dashboard","matches","profiles","analytics","skills","training","injuries","calendar","notifications"] },
  parent:          { can:"r",    scope:"own",    only:["dashboard","matches","competitions","profiles","injuries","logistics","calendar","notifications"],
                     scopes:{ matches:"school", competitions:"school", leagues:"school", calendar:"school", logistics:"team" } },
  spectator:       { can:"r",    scope:"school", only:["dashboard","matches","competitions","leagues","analytics","calendar"], deny:{ "*":["pii"] } },
};

function rbacExpandDeny(deny, resource){
  if(!deny) return [];
  const groups = [...(deny["*"]||[]), ...(deny[resource]||[])];
  return groups.flatMap(g => RBAC_FIELDS[g] || [g]);
}

// Central decision: may `role` do `action` on `resource`?
function can(role, resource, action="r"){
  if(role==="superadmin") return { allowed:true, scope:"all", deny:[] };
  const p = POLICY[role];
  if(!p) return { allowed:false, scope:"none", deny:[] };
  if(p.only && !p.only.includes(resource)) return { allowed:false, scope:"none", deny:[] };
  if(!p.can.includes(action[0])) return { allowed:false, scope:p.scope, deny:[] };
  const scope = (p.scopes && p.scopes[resource]) || p.scope || "none";
  return { allowed:true, scope, deny:rbacExpandDeny(p.deny, resource) };
}

// Live-scoring capability. Opt-in: the role must explicitly list the
// "scoring" resource with a create/update grant. superadmin bypasses.
// Roles without an `only` list (e.g. headmaster) are deliberately excluded.
function canScore(role){
  if(role==="superadmin") return true;
  const p=POLICY[role];
  return !!(p && p.only && p.only.includes("scoring") && /[cu]/.test(p.can));
}

// Security context for a role (mock: resolved from USERS/COACHES/PLAYERS).
function principalForRole(role){
  const u = USERS_INITIAL.find(x => x.role === role) || null;
  const coach  = u && u.coachId ? COACHES.find(c => c.id === u.coachId) : null;
  const player = u && u.player  ? PLAYERS.find(p => p.id === u.player)  : null;
  const teams  = coach ? [coach.team] : player ? [player.team] : [];
  return { role, userId: u ? u.id : "syn_"+role, playerId: u ? u.player : null,
           staffId: u ? u.staffId : null, coachId: u ? u.coachId : null,
           childIds: (u && u.player) ? [u.player] : [], teams, school:"HIL" };
}

function rbacAnchors(resource, row){
  if(resource==="injuries"){
    const pl = PLAYERS.find(p => p.id === row.player) || {};
    return { team: pl.team, school: pl.school || "HIL", ownId: row.player };
  }
  return { team: row.team, school: row.school || "HIL", ownId: row.id };
}

function inScope(scope, principal, resource, row){
  if(scope==="all")  return true;
  if(scope==="none") return false;
  const a = rbacAnchors(resource, row);
  if(scope==="school") return a.school === principal.school;
  if(scope==="team")   return principal.teams.includes(a.team);
  if(scope==="own")    return principal.childIds.includes(a.ownId) || a.ownId === principal.playerId;
  return false;
}

function rbacStrip(row, deny){
  if(!deny || !deny.length) return row;
  const out = { ...row };
  deny.forEach(f => { if(f in out) out[f] = null; });
  return out;
}

// The choke-point every view should read through. Today it wraps the mock
// constants; in production it becomes the authenticated API call.
const RBAC_SOURCE = {
  players: () => PLAYERS, injuries: () => INJURIES, profiles: () => PLAYERS,
  matches: () => MATCHES, competitions: () => COMPETITIONS,
};
function getData(resource, principal){
  const fn = RBAC_SOURCE[resource];
  const src = fn ? fn() : [];
  const { allowed, scope, deny } = can(principal.role, resource, "r");
  if(!allowed) return [];
  return src.filter(row => inScope(scope, principal, resource, row))
            .map(row => rbacStrip(row, deny));
}
// Single-record variant (returns null if the role may not read the resource).
function filterRecord(role, resource, record){
  if(!record) return record;
  const { allowed, deny } = can(role, resource, "r");
  if(!allowed) return null;
  return rbacStrip(record, deny);
}

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:${D.bg};color:${D.textPrimary};font-family:${D.body}}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:${D.surf3};border-radius:2px}
.os-page{animation:fadeUp .25s ease}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.pressBtn{transition:all .12s ease;transform-origin:center}
.pressBtn:active{transform:scale(0.96)}
.card-hover{transition:all .2s ease}
.card-hover:hover{transform:translateY(-1px);box-shadow:0 8px 32px rgba(0,0,0,.4)!important}
.pulse{animation:pulse 2s ease infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.spin{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.live-dot{width:6px;height:6px;border-radius:50%;background:${D.emerald};animation:livePulse 1.2s ease infinite}
@keyframes livePulse{0%,100%{box-shadow:0 0 0 0 ${D.emerald}66}50%{box-shadow:0 0 0 6px transparent}}
.skill-bar{transition:width .6s cubic-bezier(.34,1.56,.64,1)}
.tab-active{position:relative}
.tab-active::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:2px;background:${D.gradMain};border-radius:2px}

/* ── ScrbrdOS responsive layer — mobile first ── */
html{-webkit-text-size-adjust:100%}
button{touch-action:manipulation}
.os-main{padding:24px}
@keyframes sheetUp{from{transform:translateY(28px);opacity:.4}to{transform:none;opacity:1}}
@keyframes drawerIn{from{transform:translateY(100%)}to{transform:none}}
.os-bottomnav{position:fixed;left:0;right:0;bottom:0;z-index:400;display:none;gap:2px;
  background:rgba(8,12,20,.94);backdrop-filter:blur(22px) saturate(1.6);-webkit-backdrop-filter:blur(22px) saturate(1.6);
  border-top:1px solid rgba(255,255,255,.08);padding:6px 8px calc(6px + env(safe-area-inset-bottom))}
.os-drawer-scrim{position:fixed;inset:0;z-index:490;background:rgba(0,0,0,.6)}
.os-drawer{position:fixed;left:0;right:0;bottom:0;z-index:500;background:${D.surf1};
  border-top:1px solid ${D.borderMed};border-radius:20px 20px 0 0;max-height:78vh;overflow-y:auto;
  padding:14px 14px calc(18px + env(safe-area-inset-bottom));animation:drawerIn .28s cubic-bezier(.22,1,.36,1)}
.os-exit-scorer{position:fixed;top:calc(10px + env(safe-area-inset-top));left:10px;z-index:9999;
  display:flex;align-items:center;gap:6px;padding:7px 13px;border-radius:999px;cursor:pointer;
  background:rgba(10,14,28,.8);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  border:1px solid rgba(255,255,255,.14);color:#f0f4ff;font-family:${D.head};font-size:10px;
  font-weight:700;letter-spacing:.1em;box-shadow:0 8px 28px rgba(0,0,0,.5)}
@media(max-width:1180px) and (min-width:881px){
  .os-shell{--g-4:repeat(2,1fr);--g-5:repeat(3,1fr)}
}
@media(max-width:880px){
  .os-shell{--g-side-r:1fr;--g-side-l:1fr;--g-4:repeat(2,1fr);--g-5:repeat(2,1fr);
    --g-league:1.7fr repeat(6,minmax(28px,1fr))}
  .os-main{padding:14px 12px calc(92px + env(safe-area-inset-bottom))!important}
  .os-kbd,.os-username{display:none!important}
  .os-bottomnav{display:flex}
  .os-modal{align-items:flex-end!important;padding:0!important}
  .os-modal-card{max-width:100%!important;max-height:92vh!important;
    border-radius:18px 18px 0 0!important;animation:sheetUp .28s cubic-bezier(.22,1,.36,1)}
  .os-shell table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
}
@media(max-width:640px){
  .os-shell{--g-2:1fr;--g-3:1fr}
}
`;

// ══════════════════════════════════════════════════════
//  PRIMITIVE COMPONENTS
// ══════════════════════════════════════════════════════

const Card = ({ children, sx, className="card-hover", onClick }) => (
  <div onClick={onClick} className={className} style={{
    background:D.surf1, border:`1px solid ${D.border}`,
    borderRadius:D.lg, overflow:"hidden", ...sx
  }}>{children}</div>
);

const KPICard = ({ label, value, sub, icon, color=D.indigo, trend }) => (
  <Card sx={{padding:"16px 18px",cursor:"default"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
      <div>
        <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"8px"}}>{label}</div>
        <div style={{fontFamily:D.mono,fontSize:"26px",fontWeight:500,color,lineHeight:1}}>{value}</div>
        {sub&&<div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginTop:"5px"}}>{sub}</div>}
      </div>
      <div style={{width:"38px",height:"38px",borderRadius:D.md,background:color+"18",border:`1px solid ${color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px",flexShrink:0}}>{icon}</div>
    </div>
    {trend!==undefined&&(
      <div style={{marginTop:"10px",display:"flex",alignItems:"center",gap:"5px"}}>
        <span style={{color:trend>=0?D.emerald:D.rose,fontFamily:D.mono,fontSize:"11px"}}>{trend>=0?"▲":"▼"} {Math.abs(trend)}%</span>
        <span style={{color:D.textMuted,fontSize:"11px",fontFamily:D.body}}>vs last month</span>
      </div>
    )}
  </Card>
);

const SectionHeader = ({ title, sub, actions, color=D.indigo }) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"16px",flexWrap:"wrap",gap:"8px"}}>
    <div>
      <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
        <div style={{width:"3px",height:"20px",borderRadius:"2px",background:color}}/>
        <h2 style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary}}>{title}</h2>
      </div>
      {sub&&<div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginTop:"3px",paddingLeft:"13px"}}>{sub}</div>}
    </div>
    {actions&&<div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>{actions}</div>}
  </div>
);

const Btn = ({ children, onClick, variant="primary", size="md", disabled }) => {
  const bg = variant==="primary"?D.gradMain:variant==="success"?D.gradLive:variant==="danger"?D.rose:variant==="ghost"?"transparent":D.surf3;
  const col = variant==="ghost"?D.textSecondary:"#fff";
  const pad = size==="sm"?"5px 12px":size==="lg"?"12px 24px":"8px 18px";
  const fs  = size==="sm"?"11px":size==="lg"?"14px":"12px";
  return (
    <button onClick={onClick} disabled={disabled} className="pressBtn" style={{
      padding:pad,borderRadius:D.pill,border:`1px solid ${variant==="ghost"?D.border:"transparent"}`,
      background:bg,color:col,cursor:disabled?"not-allowed":"pointer",fontFamily:D.head,
      fontSize:fs,fontWeight:700,letterSpacing:"0.04em",opacity:disabled?0.4:1,
      boxShadow:variant==="primary"?`0 2px 12px ${D.indigo}33`:"none",
    }}>{children}</button>
  );
};

const Badge = ({ children, color=D.indigo }) => (
  <span style={{
    padding:"2px 8px",borderRadius:D.pill,fontFamily:D.mono,fontSize:"9px",fontWeight:500,
    background:color+"18",border:`1px solid ${color}30`,color,letterSpacing:"0.05em",textTransform:"uppercase",
  }}>{children}</span>
);

const Avatar = ({ name, size=32, color=D.indigo }) => (
  <div style={{width:px(size),height:px(size),borderRadius:"50%",background:`linear-gradient(135deg,${color}33,${color}55)`,
    border:`1px solid ${color}44`,display:"flex",alignItems:"center",justifyContent:"center",
    fontFamily:D.mono,fontSize:px(Math.round(size*0.35)),fontWeight:700,color,flexShrink:0}}>
    {initials(name)}
  </div>
);

const StatusDot = ({ status }) => {
  const c = status==="live"?D.emerald:status==="upcoming"?D.sky:status==="complete"?D.textMuted:D.amber;
  return <div className={status==="live"?"live-dot":""} style={{width:"7px",height:"7px",borderRadius:"50%",background:c,flexShrink:0,
    ...(status!=="live"?{}:{})}}/>;
};

const ProgressBar = ({ pct, color=D.indigo, height=4 }) => (
  <div style={{width:"100%",height:px(height),background:D.surf3,borderRadius:"4px",overflow:"hidden"}}>
    <div className="skill-bar" style={{height:"100%",width:`${pct}%`,background:color,borderRadius:"4px"}}/>
  </div>
);

const SkillBar = ({ label, value, color=D.indigo }) => (
  <div style={{marginBottom:"8px"}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{label}</span>
      <span style={{fontFamily:D.mono,fontSize:"11px",color}}>{value}</span>
    </div>
    <ProgressBar pct={value} color={color}/>
  </div>
);

const Pill = ({ children, color=D.indigo, onClick }) => (
  <span onClick={onClick} style={{
    display:"inline-flex",alignItems:"center",padding:"3px 10px",borderRadius:D.pill,
    fontFamily:D.body,fontSize:"11px",fontWeight:500,cursor:onClick?"pointer":"default",
    background:color+"15",border:`1px solid ${color}28`,color,
  }}>{children}</span>
);

const Modal = ({ title, children, onClose, width="520px" }) => (
  <div className="os-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:"20px"}}>
    <div className="os-modal-card" style={{background:D.surf1,borderRadius:D.xl,border:`1px solid ${D.borderMed}`,width:"100%",maxWidth:width,maxHeight:"90vh",overflow:"auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${D.border}`}}>
        <h3 style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:D.textPrimary}}>{title}</h3>
        <button onClick={onClose} className="pressBtn" style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"18px"}}>✕</button>
      </div>
      <div style={{padding:"20px"}}>{children}</div>
    </div>
  </div>
);

const Input = ({ label, value, onChange, type="text", placeholder, small }) => (
  <div style={{marginBottom:small?"0":"14px"}}>
    {label&&<div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"5px"}}>{label}</div>}
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{width:"100%",padding:"9px 12px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
        color:D.textPrimary,fontFamily:D.body,fontSize:"13px",outline:"none"}}/>
  </div>
);

const Select = ({ label, value, onChange, options }) => (
  <div style={{marginBottom:"14px"}}>
    {label&&<div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"5px"}}>{label}</div>}
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{width:"100%",padding:"9px 12px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
        color:D.textPrimary,fontFamily:D.body,fontSize:"13px",outline:"none"}}>
      {options.map(o=><option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
    </select>
  </div>
);

// ── RADAR / SPIDER CHART ───────────────────────────────
function RadarChart({ data, color=D.indigo, size=160 }) {
  const keys = Object.keys(data);
  const n = keys.length;
  const cx = size/2, cy = size/2, r = size*0.38;
  const angle = i => (i/n)*2*Math.PI - Math.PI/2;
  const pt = (i,v) => [cx + r*(v/100)*Math.cos(angle(i)), cy + r*(v/100)*Math.sin(angle(i))];
  const grid = [20,40,60,80,100];
  const pts = keys.map((k,i)=>pt(i,data[k]));
  const polyPts = pts.map(p=>p.join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{width:px(size),height:px(size)}}>
      {/* Grid */}
      {grid.map(g=>(
        <polygon key={g} points={keys.map((_,i)=>{const[x,y]=pt(i,g);return`${x},${y}`}).join(" ")}
          fill="none" stroke={D.surf3} strokeWidth="0.8"/>
      ))}
      {/* Spokes */}
      {keys.map((_,i)=>{
        const[x,y]=pt(i,100);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={D.surf3} strokeWidth="0.8"/>;
      })}
      {/* Data polygon */}
      <polygon points={polyPts} fill={color+"28"} stroke={color} strokeWidth="1.5"/>
      {/* Dots */}
      {pts.map(([x,y],i)=><circle key={i} cx={x} cy={y} r="3" fill={color} stroke={D.surf1} strokeWidth="1.5"/>)}
      {/* Labels */}
      {keys.map((k,i)=>{
        const[x,y]=pt(i,118);
        return <text key={k} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
          fontSize="7.5" fontFamily={D.body} fill={D.textMuted} fontWeight="500">{k}</text>;
      })}
    </svg>
  );
}

// ══════════════════════════════════════════════════════
//  SIDEBAR
// ══════════════════════════════════════════════════════
function Sidebar({ role, active, onNav, collapsed, onToggle, notifCount }) {
  const nav = ROLES[role]?.nav || [];
  const rc  = ROLES[role];
  return (
    <div style={{
      width: collapsed ? "58px" : "210px",
      minHeight:"100vh", background:D.surf0,
      borderRight:`1px solid ${D.border}`,
      display:"flex", flexDirection:"column",
      transition:"width .25s cubic-bezier(.34,1.56,.64,1)",
      flexShrink:0, position:"sticky", top:0, height:"100vh", overflow:"hidden",
    }}>
      {/* Logo */}
      <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"10px",minHeight:"60px"}}>
        {collapsed
          ? <div style={{width:"30px",height:"30px",borderRadius:D.md,background:D.gradMain,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",flexShrink:0}}>🏏</div>
          : <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"28px",objectFit:"contain",filter:"brightness(1.1)",flexShrink:0,maxWidth:"120px"}}/>
        }
        <button onClick={onToggle} className="pressBtn" style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"14px",flexShrink:0}}>
          {collapsed?"›":"‹"}
        </button>
      </div>

      {/* Role badge */}
      {!collapsed&&(
        <div style={{padding:"10px 14px",borderBottom:`1px solid ${D.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"7px 10px",borderRadius:D.md,background:rc.color+"12",border:`1px solid ${rc.color}22`}}>
            <span style={{fontSize:"14px"}}>{rc.icon}</span>
            <div>
              <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:rc.color}}>{rc.label}</div>
              <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>Active role</div>
            </div>
          </div>
        </div>
      )}

      {/* Sport switcher — ScrbrdOS multi-sport shell */}
      {!collapsed&&<SportSwitcher/>}

      {/* Nav */}
      <nav style={{flex:1,padding:"8px 0",overflowY:"auto"}}>
        {nav.map(key=>{
          const m = NAV_META[key];
          const isActive = active===key;
          const isBell = key==="notifications";
          return (
            <button key={key} onClick={()=>onNav(key)} className="pressBtn" style={{
              width:"100%",padding:collapsed?"12px 0":"10px 14px",
              display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",
              background:isActive?D.indigo+"18":"transparent",
              border:`1px solid ${isActive?D.indigo+"33":"transparent"}`,
              borderRadius:collapsed?"0":D.md,
              margin:collapsed?"0":"1px 6px",
              width:collapsed?"100%":"calc(100% - 12px)",
              transition:"all .15s",
              position:"relative",
            }}>
              <span style={{fontSize:"15px",textAlign:"center",width:collapsed?"100%":"auto",color:isActive?ROLES[role].color:D.textSecondary}}>{m.icon}</span>
              {!collapsed&&<span style={{fontFamily:D.body,fontSize:"12px",fontWeight:isActive?600:400,color:isActive?D.textPrimary:D.textSecondary}}>{m.label}</span>}
              {isBell&&notifCount>0&&<span style={{marginLeft:"auto",background:D.rose,color:"#fff",borderRadius:D.pill,padding:"1px 6px",fontFamily:D.mono,fontSize:"9px",fontWeight:700}}>{notifCount}</span>}
            </button>
          );
        })}
      </nav>

      {/* Bottom version */}
      {!collapsed&&<div style={{padding:"12px 14px",borderTop:`1px solid ${D.border}`}}>
        <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,letterSpacing:"0.06em"}}>ScrbrdOS v3.0 · CricketOS</div>
      </div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  TOPBAR + GLOBAL SEARCH
// ══════════════════════════════════════════════════════
function GlobalSearch({ onNav, onClose }) {
  const [q, setQ] = useState("");
  const [aiMode, setAiMode] = useState(false);
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(()=>{ inputRef.current?.focus(); },[]);

  const ALL_PLAYERS = PLAYERS;
  const ALL_STAFF   = STAFF.concat(COACHES.map(c=>({...c,role:"coach",name:c.name})));

  const results = q.length < 2 ? [] : [
    ...ALL_PLAYERS.filter(p=>p.name.toLowerCase().includes(q.toLowerCase())).slice(0,4).map(p=>({
      type:"player", icon:ROLES[p.role==="WK"?"player":"player"]?.icon||"🏏",
      label:p.name, sub:`${p.role} · ${p.team} · ${p.school}`,
      action:()=>{ onNav("profiles"); onClose(); },
    })),
    ...ALL_STAFF.filter(s=>s.name.toLowerCase().includes(q.toLowerCase())).slice(0,3).map(s=>({
      type:"staff", icon:"👤",
      label:s.name, sub:`${s.role} · ${s.school||"Hilton College"}`,
      action:()=>{ onNav("staff"); onClose(); },
    })),
    ...MATCHES.filter(m=>(m.home+m.away+m.venue).toLowerCase().includes(q.toLowerCase())).slice(0,3).map(m=>({
      type:"match", icon:"🏏",
      label:`${m.home} vs ${m.away}`, sub:`${m.date} · ${m.format} · ${m.status}`,
      action:()=>{ onNav("matches"); onClose(); },
    })),
    ...COMPETITIONS.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())).slice(0,2).map(c=>({
      type:"competition", icon:"🏆",
      label:c.name, sub:c.format,
      action:()=>{ onNav("competitions"); onClose(); },
    })),
    ...SCHOOLS_REGISTRY.filter(s=>s.name.toLowerCase().includes(q.toLowerCase())).slice(0,2).map(s=>({
      type:"school", icon:"🏫",
      label:s.name, sub:`${s.city} · ${s.province}`,
      action:()=>{ onClose(); },
    })),
  ];

  const statKeywords = ["average","strike rate","wickets","runs","economy","best","career","form","stats","vs","against","how many","who is","top scorer","best bowler"];
  const looksLikeStat = q.length > 8 && statKeywords.some(k=>q.toLowerCase().includes(k));

  const askGuru = async () => {
    if (!q.trim()) return;
    setAiLoading(true); setAiMode(true); setAiAnswer("");
    const playerContext = PLAYERS.map(p=>`${p.name} (${p.role}, ${p.team}, ${p.school})`).join(", ");
    const matchContext = MATCHES.slice(0,5).map(m=>`${m.home} vs ${m.away} ${m.date} ${m.result||m.status}`).join("; ");
    try {
      // Goes to our own service, which holds the credential. The browser has
      // no API key — see apps/web/src/lib/ai.js and services/api/ai/.
      const answer = await askStatGuru(q, `Players: ${playerContext}. Recent matches: ${matchContext}.`);
      setAiAnswer(answer || "No answer available.");
    } catch { setAiAnswer("StatGuru offline — check your connection."); }
    setAiLoading(false);
  };

  const typeColor = t => ({player:D.sky,staff:D.indigo,match:D.emerald,competition:D.amber,school:D.teal})[t]||D.textMuted;

  return (
    <div style={{position:"fixed",inset:0,zIndex:400,background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"80px 16px 0"}}>
      <div style={{width:"100%",maxWidth:"640px",borderRadius:D.xl,border:`1px solid ${D.borderMed}`,background:D.surf1,overflow:"hidden",boxShadow:"0 24px 80px rgba(0,0,0,0.5)"}}>
        {/* Input row */}
        <div style={{display:"flex",alignItems:"center",gap:"10px",padding:"14px 16px",borderBottom:`1px solid ${D.border}`}}>
          <span style={{fontSize:"16px",color:D.textMuted}}>🔍</span>
          <input ref={inputRef} value={q} onChange={e=>{setQ(e.target.value);setAiMode(false);setAiAnswer("");}}
            onKeyDown={e=>{if(e.key==="Escape")onClose();if(e.key==="Enter")askGuru();}}
            placeholder="Search players, matches, staff… or ask StatGuru anything"
            style={{flex:1,background:"transparent",border:"none",outline:"none",fontFamily:D.body,fontSize:"14px",color:D.textPrimary,}}/>
          {looksLikeStat&&!aiMode&&(
            <button onClick={askGuru} className="pressBtn" style={{display:"flex",alignItems:"center",gap:"5px",padding:"5px 12px",borderRadius:D.pill,cursor:"pointer",background:`${D.violet}18`,border:`1px solid ${D.violet}44`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.violet,whiteSpace:"nowrap"}}>
              ✦ Ask StatGuru
            </button>
          )}
          <button onClick={onClose} className="pressBtn" style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"18px",lineHeight:1}}>×</button>
        </div>

        {/* AI Guru answer */}
        {aiMode&&(
          <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`,background:`${D.violet}0a`}}>
            <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px"}}>
              <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.violet,letterSpacing:"0.06em"}}>✦ STATGURU</span>
              {aiLoading&&<span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>thinking…</span>}
            </div>
            {aiLoading
              ? <div style={{display:"flex",gap:"4px"}}>{[0,1,2].map(i=><div key={i} style={{width:"6px",height:"6px",borderRadius:"50%",background:D.violet,opacity:0.5,animation:`pulse 1s ${i*0.2}s infinite`}}/>)}</div>
              : <div style={{fontFamily:D.body,fontSize:"13px",color:D.textSecondary,lineHeight:1.6}}>{aiAnswer}</div>
            }
          </div>
        )}

        {/* Search results */}
        {!aiMode&&results.length>0&&(
          <div style={{maxHeight:"360px",overflowY:"auto"}}>
            {results.map((r,i)=>(
              <button key={i} onClick={r.action} className="pressBtn" style={{width:"100%",display:"flex",alignItems:"center",gap:"12px",padding:"10px 16px",background:"transparent",border:"none",cursor:"pointer",textAlign:"left",borderBottom:`1px solid ${D.border}44`}}>
                <div style={{width:"28px",height:"28px",borderRadius:D.md,background:`${typeColor(r.type)}18`,border:`1px solid ${typeColor(r.type)}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"13px",flexShrink:0}}>{r.icon}</div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary}}>{r.label}</div>
                  <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,textTransform:"uppercase",letterSpacing:"0.04em"}}>{r.sub}</div>
                </div>
                <span style={{padding:"2px 7px",borderRadius:D.pill,background:`${typeColor(r.type)}14`,fontFamily:D.head,fontSize:"8px",fontWeight:700,color:typeColor(r.type),textTransform:"uppercase",letterSpacing:"0.06em"}}>{r.type}</span>
              </button>
            ))}
          </div>
        )}

        {/* Empty / hint state */}
        {!aiMode&&q.length<2&&(
          <div style={{padding:"20px 16px"}}>
            <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginBottom:"12px"}}>Quick Access</div>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
              {[["🏏 Players","profiles"],["📊 Analytics","analytics"],["🏆 Competitions","competitions"],["📅 Calendar","calendar"],["🌿 Fields","fields"]].map(([l,p])=>(
                <button key={p} onClick={()=>{onNav(p);onClose();}} className="pressBtn" style={{padding:"6px 12px",borderRadius:D.pill,cursor:"pointer",background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"10px",color:D.textMuted}}>{l}</button>
              ))}
            </div>
            <div style={{marginTop:"14px",padding:"10px 14px",borderRadius:D.md,background:`${D.violet}08`,border:`1px solid ${D.violet}22`}}>
              <span style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.violet}}>✦ StatGuru tip: </span>
              <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Try "What is James Whitfield's strike rate?" or "Who are the top bowlers this season?"</span>
            </div>
          </div>
        )}

        {/* No results */}
        {!aiMode&&q.length>=2&&results.length===0&&(
          <div style={{padding:"24px 16px",textAlign:"center"}}>
            <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,marginBottom:"10px"}}>No results for "{q}"</div>
            <button onClick={askGuru} className="pressBtn" style={{padding:"8px 18px",borderRadius:D.pill,cursor:"pointer",background:`${D.violet}18`,border:`1px solid ${D.violet}44`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.violet}}>✦ Ask StatGuru instead</button>
          </div>
        )}

        {/* Footer */}
        <div style={{padding:"8px 16px",borderTop:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"12px"}}>
          <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>↵ Enter to ask StatGuru</span>
          <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>Esc to close</span>
          <span style={{marginLeft:"auto",fontFamily:D.head,fontSize:"8px",fontWeight:700,color:D.violet}}>✦ StatGuru powered by Claude</span>
        </div>
      </div>
    </div>
  );
}

function TopBar({ role, onRoleChange, onNav, userName }) {
  const [roleOpen, setRoleOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const unread = NOTIFICATIONS.filter(n=>!n.read).length;

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(()=>{
    const handler = e=>{ if((e.metaKey||e.ctrlKey)&&e.key==="k"){ e.preventDefault(); setSearchOpen(true); }};
    window.addEventListener("keydown",handler);
    return ()=>window.removeEventListener("keydown",handler);
  },[]);

  return (
    <>
      {searchOpen&&<GlobalSearch onNav={onNav} onClose={()=>setSearchOpen(false)}/>}
      <div style={{height:"52px",background:D.surf0,borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",padding:"0 16px",gap:"10px",flexShrink:0,position:"sticky",top:0,zIndex:100}}>

        {/* Live match chip */}
        <button onClick={()=>onNav("matches")} className="pressBtn" style={{display:"flex",alignItems:"center",gap:"6px",padding:"4px 10px",borderRadius:D.pill,background:D.emerald+"14",border:`1px solid ${D.emerald}30`,cursor:"pointer",flexShrink:0}}>
          <div className="live-dot"/><span style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.emerald,letterSpacing:"0.06em",whiteSpace:"nowrap"}}>LIVE</span>
        </button>

        {/* Search bar */}
        <button onClick={()=>setSearchOpen(true)} className="pressBtn" style={{flex:1,maxWidth:"420px",display:"flex",alignItems:"center",gap:"8px",padding:"7px 12px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,cursor:"pointer",textAlign:"left"}}>
          <span style={{fontSize:"13px",color:D.textMuted}}>🔍</span>
          <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,flex:1}}>Search or ask StatGuru…</span>
          <span className="os-kbd" style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,background:D.surf3,padding:"2px 6px",borderRadius:"4px",flexShrink:0}}>⌘K</span>
        </button>

        <div style={{flex:1}}/>

        {/* Notifications */}
        <button onClick={()=>onNav("notifications")} className="pressBtn" style={{position:"relative",background:"none",border:"none",cursor:"pointer",fontSize:"16px",flexShrink:0}}>
          🔔
          {unread>0&&<span style={{position:"absolute",top:"-2px",right:"-2px",background:D.rose,color:"#fff",borderRadius:D.pill,padding:"0 4px",fontFamily:D.mono,fontSize:"8px",fontWeight:700,minWidth:"14px",textAlign:"center"}}>{unread}</span>}
        </button>

        {/* Role switcher */}
        <div style={{position:"relative",flexShrink:0}}>
          <button onClick={()=>setRoleOpen(!roleOpen)} className="pressBtn" style={{display:"flex",alignItems:"center",gap:"6px",padding:"5px 10px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,cursor:"pointer"}}>
            <span style={{fontSize:"13px"}}>{ROLES[role]?.icon}</span>
            <span className="os-username" style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,maxWidth:"90px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userName||ROLES[role]?.label}</span>
            <span style={{fontSize:"9px",color:D.textMuted}}>▼</span>
          </button>
          {roleOpen&&(
            <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:D.surf2,border:`1px solid ${D.borderMed}`,borderRadius:D.lg,overflow:"hidden",minWidth:"180px",zIndex:200,boxShadow:"0 8px 32px rgba(0,0,0,0.4)"}}>
              <div style={{padding:"8px 12px 4px",fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted}}>Switch Role (Demo)</div>
              {Object.entries(ROLES).map(([r,rc])=>(
                <button key={r} onClick={()=>{onRoleChange(r);setRoleOpen(false);}} className="pressBtn" style={{
                  width:"100%",padding:"8px 12px",display:"flex",alignItems:"center",gap:"8px",
                  background:role===r?rc.color+"18":"transparent",border:"none",cursor:"pointer",textAlign:"left",
                }}>
                  <span>{rc.icon}</span>
                  <span style={{fontFamily:D.body,fontSize:"12px",color:role===r?rc.color:D.textSecondary}}>{rc.label}</span>
                  {role===r&&<span style={{marginLeft:"auto",width:"6px",height:"6px",borderRadius:"50%",background:rc.color}}/>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════
//  DASHBOARD VIEW
// ══════════════════════════════════════════════════════
function DashboardView({ role, onNav }) {
  const rc = ROLES[role];
  const liveMatch = MATCHES.find(m=>m.status==="live");
  const upcomingMatches = MATCHES.filter(m=>m.status==="upcoming").slice(0,3);
  const injuries = INJURIES.filter(i=>i.restricted);
  const unreadNotifs = NOTIFICATIONS.filter(n=>!n.read).length;

  return (
    <div className="os-page">
      <div style={{marginBottom:"20px"}}>
        <h1 style={{fontFamily:D.head,fontSize:"22px",fontWeight:800,color:D.textPrimary,marginBottom:"3px"}}>
          Welcome back, {rc.icon} <span style={{color:rc.color}}>{rc.label}</span>
        </h1>
        <p style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted}}>Hilton College, KZN · {new Date().toLocaleDateString("en-ZA",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
      </div>

      {/* KPI row */}
      {(role==="superadmin"||role==="schooladmin"||role==="coach")&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:"12px",marginBottom:"24px"}}>
          <KPICard label="Active Players" value="53"  icon="👥" color={D.sky}    trend={+5}  sub="Across 3 squads"/>
          <KPICard label="League Position" value="1st" icon="🏆" color={D.amber}  sub="4W-1L · 8pts"    />
          <KPICard label="Win Rate"        value="72%" icon="📈" color={D.emerald}trend={+8}  sub="Last 12 matches"/>
          <KPICard label="Injuries"        value={injuries.length} icon="🏥" color={injuries.length>3?D.rose:D.orange} sub="Active restrictions"/>
          <KPICard label="Sessions This Wk"value="4"  icon="💪" color={D.violet} sub="Next: Today 14:30"/>
          <KPICard label="Alerts"          value={unreadNotifs} icon="🔔" color={D.rose} sub="Unread notifications"/>
        </div>
      )}
      {role==="player"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:"12px",marginBottom:"24px"}}>
          <KPICard label="Batting Avg"    value="48.2" icon="🏏" color={D.sky}     trend={+12} sub="Season"/>
          <KPICard label="Strike Rate"    value="135"  icon="⚡" color={D.amber}    trend={+4}  sub="Season"/>
          <KPICard label="Next Training"  value="Today" icon="💪" color={D.emerald} sub="14:30 — Nets 1-3"/>
          <KPICard label="Next Match"     value="Sat"  icon="📅" color={D.violet}   sub="vs Kearsney College"/>
        </div>
      )}
      {role==="parent"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:"12px",marginBottom:"24px"}}>
          <KPICard label="Next Match"    value="Sat"   icon="📅" color={D.sky}    sub="vs Kearsney Away"/>
          <KPICard label="Transport"     value="Bus ✓" icon="🚌" color={D.emerald} sub="Departs 08:00"/>
          <KPICard label="Season Avg"    value="48.2"  icon="🏏" color={D.amber}   sub="James Whitfield"/>
          <KPICard label="Alerts"        value={unreadNotifs} icon="🔔" color={D.rose} sub="Unread"/>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"var(--g-side-r,1fr 340px)",gap:"16px",alignItems:"start"}}>
        {/* Left column */}
        <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>

          {/* Live match */}
          {liveMatch&&(
            <Card sx={{background:`linear-gradient(135deg,${D.emerald}0a,${D.surf1})`,border:`1px solid ${D.emerald}22`}}>
              <div style={{padding:"14px 16px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"12px"}}>
                  <div className="live-dot"/>
                  <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.emerald,letterSpacing:"0.1em"}}>LIVE MATCH</span>
                  <span style={{marginLeft:"auto",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Hilton vs Kearsney · T20</span>
                </div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div>
                    <div style={{fontFamily:D.head,fontSize:"28px",fontWeight:800,color:D.textPrimary}}>{liveMatch.scorecard.home.score}</div>
                    <div style={{fontFamily:D.mono,fontSize:"12px",color:D.textMuted}}>({liveMatch.scorecard.home.overs} overs) · Hilton U19A</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,marginBottom:"6px"}}>Target: 187 to win</div>
                    <div style={{fontFamily:D.mono,fontSize:"12px",color:D.amber}}>CRR: 9.95 · RRR: 8.21</div>
                  </div>
                </div>
                <div style={{marginTop:"12px"}}>
                  <Btn onClick={()=>onNav("matches")} variant="success" size="sm">Open Match Centre →</Btn>
                </div>
              </div>
            </Card>
          )}

          {/* Upcoming fixtures */}
          <Card>
            <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>Upcoming Fixtures</span>
              <button onClick={()=>onNav("logistics")} style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.sky}}>View all →</button>
            </div>
            {upcomingMatches.map(m=>(
              <div key={m.id} style={{padding:"12px 16px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"12px"}}>
                <div style={{width:"42px",textAlign:"center",flexShrink:0}}>
                  <div style={{fontFamily:D.mono,fontSize:"16px",fontWeight:700,color:D.textPrimary}}>{new Date(m.date).getDate()}</div>
                  <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted,textTransform:"uppercase"}}>{new Date(m.date).toLocaleString("en",{month:"short"})}</div>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary,marginBottom:"2px"}}>{m.homeTeam} vs {m.awayTeam}</div>
                  <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>📍 {m.venue}</div>
                </div>
                {m.transport?.bus&&<Pill color={D.sky}>🚌 Bus</Pill>}
                <StatusDot status={m.status}/>
              </div>
            ))}
          </Card>

          {/* Squad fitness overview */}
          {(role==="coach"||role==="superadmin"||role==="schooladmin")&&(
            <Card>
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>Squad Fitness — U19A</span>
                <button onClick={()=>onNav("injuries")} style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.sky}}>Injury log →</button>
              </div>
              <div style={{padding:"12px 16px",display:"flex",flexWrap:"wrap",gap:"10px"}}>
                {PLAYERS.filter(p=>p.team==="U19A").map(p=>(
                  <div key={p.id} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"4px"}}>
                    <div style={{position:"relative"}}>
                      <Avatar name={p.name} size={36} color={fitnessColor(p.fitness)}/>
                      <div style={{position:"absolute",bottom:-2,right:-2,width:"10px",height:"10px",borderRadius:"50%",background:fitnessColor(p.fitness),border:`1.5px solid ${D.surf1}`}}/>
                    </div>
                    <span style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted}}>{p.name.split(" ").pop()}</span>
                  </div>
                ))}
              </div>
              <div style={{padding:"8px 16px",borderTop:`1px solid ${D.border}`,display:"flex",gap:"16px"}}>
                {[["fit",D.emerald],["rehab",D.orange],["injured",D.rose]].map(([s,c])=>(
                  <div key={s} style={{display:"flex",alignItems:"center",gap:"5px"}}>
                    <div style={{width:"7px",height:"7px",borderRadius:"50%",background:c}}/>
                    <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,textTransform:"capitalize"}}>{s}: {PLAYERS.filter(p=>p.team==="U19A"&&p.fitness===s).length}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>

          {/* League table mini */}
          <Card>
            <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`}}>
              <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>Gauteng T20 League</div>
              <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginTop:"2px"}}>TOP 6</div>
            </div>
            {COMPETITIONS[0].table.map((t,i)=>(
              <div key={t.team} style={{padding:"8px 14px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"8px",background:t.team.includes("Hilton")?D.indigo+"0a":"transparent"}}>
                <span style={{fontFamily:D.mono,fontSize:"11px",fontWeight:700,color:i===0?D.amber:D.textMuted,width:"14px"}}>{i+1}</span>
                <span style={{flex:1,fontFamily:D.body,fontSize:"11px",fontWeight:t.team.includes("Hilton")?600:400,color:t.team.includes("Hilton")?D.textPrimary:D.textSecondary}}>{t.team}</span>
                <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>{t.W}W</span>
                <span style={{fontFamily:D.mono,fontSize:"11px",fontWeight:700,color:t.team.includes("Hilton")?D.emerald:D.textSecondary}}>{t.pts}</span>
              </div>
            ))}
            <div style={{padding:"8px 14px"}}>
              <button onClick={()=>onNav("competitions")} style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.sky}}>Full standings →</button>
            </div>
          </Card>

          {/* Recent notifications */}
          <Card>
            <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>Recent Alerts</span>
              <button onClick={()=>onNav("notifications")} style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.sky}}>All →</button>
            </div>
            {NOTIFICATIONS.slice(0,4).map(n=>{
              const ic = n.type==="match"?"🏏":n.type==="injury"?"🏥":n.type==="training"?"💪":n.type==="transport"?"🚌":"📢";
              const uc = n.urgency==="high"?D.rose:n.urgency==="medium"?D.amber:D.textMuted;
              return (
                <div key={n.id} style={{padding:"9px 14px",borderBottom:`1px solid ${D.border}`,background:n.read?"transparent":D.indigo+"06"}}>
                  <div style={{display:"flex",gap:"8px",alignItems:"flex-start"}}>
                    <span style={{fontSize:"13px",flexShrink:0,marginTop:"1px"}}>{ic}</span>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"2px"}}>
                        <span style={{fontFamily:D.body,fontSize:"11px",fontWeight:n.read?400:600,color:D.textPrimary}}>{n.title}</span>
                        {!n.read&&<div style={{width:"5px",height:"5px",borderRadius:"50%",background:uc,flexShrink:0,marginTop:"3px"}}/>}
                      </div>
                      <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{n.body}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>

          {/* Today's training */}
          <Card>
            <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`}}>
              <span style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>Today's Sessions</span>
            </div>
            {TRAINING_SESSIONS.filter(s=>s.date===dateStr(today)).map(s=>(
              <div key={s.id} style={{padding:"10px 14px",borderBottom:`1px solid ${D.border}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:"3px"}}>
                  <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>{s.title}</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.amber}}>{s.time}</span>
                </div>
                <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{s.team} · {s.venue} · {s.duration}min</div>
              </div>
            ))}
            <div style={{padding:"8px 14px"}}>
              <button onClick={()=>onNav("training")} style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.sky}}>Full schedule →</button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  MATCH CENTRE VIEW

// ══════════════════════════════════════════════════════
//  WEATHER CHIP — reusable
// ══════════════════════════════════════════════════════
function WeatherChip({ w, compact }) {
  if (!w) return null;
  const bc = w.playable ? D.emerald : D.rose;
  if (compact) return (
    <div style={{display:"flex",alignItems:"center",gap:"5px",padding:"3px 8px",borderRadius:D.pill,
      background:bc+"14",border:`1px solid ${bc}28`}}>
      <span style={{fontSize:"13px"}}>{w.icon}</span>
      <span style={{fontFamily:D.mono,fontSize:"10px",color:bc,fontWeight:600}}>{w.tempC}°C</span>
      <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{w.condition}</span>
      {!w.playable && <span style={{fontFamily:D.head,fontSize:"9px",color:D.rose,fontWeight:700,letterSpacing:"0.05em"}}>⚠ NOT PLAYABLE</span>}
    </div>
  );
  return (
    <div style={{background:D.surf2,borderRadius:D.lg,padding:"14px 16px",border:`1px solid ${bc}22`}}>
      <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"10px"}}>
        <span style={{fontSize:"32px"}}>{w.icon}</span>
        <div>
          <div style={{fontFamily:D.head,fontSize:"20px",fontWeight:800,color:D.textPrimary}}>{w.tempC}°C</div>
          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>{w.condition}</div>
        </div>
        <div style={{marginLeft:"auto",padding:"5px 12px",borderRadius:D.pill,background:bc+"18",border:`1px solid ${bc}30`}}>
          <span style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:bc}}>{w.playable?"✓ PLAYABLE":"⚠ NOT PLAYABLE"}</span>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"var(--g-4,repeat(4,1fr))",gap:"8px",marginBottom:"10px"}}>
        {[["💧 Humidity",`${w.humidity}%`],["💨 Wind",`${w.windKph} km/h ${w.windDir}`],[`☂ Rain`,`${w.rainChancePct}%`],["☀️ UV",`${w.uvIndex}/11`]].map(([l,v])=>(
          <div key={l} style={{textAlign:"center",padding:"7px 4px",background:D.surf3,borderRadius:D.sm}}>
            <div style={{fontFamily:D.mono,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{v}</div>
            <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted,marginTop:"2px"}}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,background:D.surf3,padding:"8px 10px",borderRadius:D.sm,fontStyle:"italic"}}>
        📋 {w.forecast}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  FIELDS VIEW — rich ground & pitch profiles
// ══════════════════════════════════════════════════════
function FieldsView({ role }) {
  const [selGround, setSelGround] = useState(GROUNDS[0]);
  const [selPitch,  setSelPitch]  = useState(0);
  const [tab, setTab]             = useState("overview");
  const canEdit = role==="superadmin"||role==="schooladmin"||role==="groundskeeper";
  const gk = selGround.groundskeeper ? STAFF.find(s=>s.id===selGround.groundskeeper) : null;

  const condColor = c => c==="Excellent"||c==="Match-ready"?"emerald":c==="Good"?"sky":c==="Fair"||c==="Moderate"?"amber":"rose";
  const condC     = c => D[condColor(c)] || D.textMuted;

  const pitch = selGround.pitches?.[selPitch];

  const PitchVisual = ({ p }) => {
    if (!p) return null;
    const cracksLevel = p.cracks==="None"?0:p.cracks==="Minor"?1:p.cracks==="Moderate"?2:p.cracks==="Settling"?1:3;
    const bounceColor = p.bounce?.includes("True")?D.emerald:p.bounce?.includes("Lively")?D.amber:p.bounce?.includes("low")?D.rose:D.sky;
    return (
      <div style={{background:D.surf2,borderRadius:D.lg,padding:"16px",border:`1px solid ${D.border}`,marginBottom:"14px"}}>
        <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"12px"}}>PITCH VISUAL — STRIP {p.num}</div>
        {/* Pitch diagram */}
        <div style={{display:"flex",justifyContent:"center",marginBottom:"14px"}}>
          <svg viewBox="0 0 80 220" style={{width:"60px",height:"165px"}}>
            {/* Pitch rectangle */}
            <rect x={5} y={5} width={70} height={210} rx={2} fill="#c8a96a" stroke="#8a7040" strokeWidth={1}/>
            {/* Crease lines */}
            <line x1={5} y1={35}  x2={75} y2={35}  stroke="white" strokeWidth={1.5} opacity={0.8}/>
            <line x1={5} y1={185} x2={75} y2={185} stroke="white" strokeWidth={1.5} opacity={0.8}/>
            <line x1={5} y1={45}  x2={75} y2={45}  stroke="white" strokeWidth={1} opacity={0.5}/>
            <line x1={5} y1={175} x2={75} y2={175} stroke="white" strokeWidth={1} opacity={0.5}/>
            {/* Stumps */}
            {[-8,0,8].map(x=>(
              <g key={x}>
                <rect x={35+x-1} y={20}  width={2} height={14} rx={0.5} fill="white"/>
                <rect x={35+x-1} y={186} width={2} height={14} rx={0.5} fill="white"/>
              </g>
            ))}
            {/* Cracks simulation */}
            {cracksLevel>=1&&[30,70,110,150].map(y=>(
              <line key={y} x1={10+Math.random()*10} y1={y} x2={30+Math.random()*20} y2={y+8} stroke="#6b4f20" strokeWidth={0.8} opacity={0.6}/>
            ))}
            {cracksLevel>=2&&[50,90,130,160].map(y=>(
              <line key={y} x1={40+Math.random()*10} y1={y} x2={60+Math.random()*10} y2={y+10} stroke="#5a3e1a" strokeWidth={1.2} opacity={0.7}/>
            ))}
            {/* Grass coverage */}
            {p.grass&&!p.grass.includes("N/A")&&(
              <rect x={5} y={5} width={70} height={210} rx={2} fill="#4a8c30" opacity={p.grass?.includes("short")?0.12:0.22}/>
            )}
          </svg>
        </div>
        {/* Pitch data grid */}
        <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"8px"}}>
          {[
            ["Surface",   p.surface,   D.textPrimary],
            ["Condition", p.condition, condC(p.condition)],
            ["Bounce",    p.bounce,    bounceColor],
            ["Cracks",    p.cracks,    p.cracks==="None"?D.emerald:D.orange],
            ["Grass",     p.grass||"—",D.lime],
            ["Moisture",  p.moisture||"—", D.sky],
            ["Spin Assist",p.spinAssist||"—",D.violet],
            ["Seam Move", p.seamMovement||"—",D.amber],
          ].map(([l,v,c])=>(
            <div key={l} style={{padding:"7px 10px",background:D.surf3,borderRadius:D.sm}}>
              <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted,marginBottom:"3px"}}>{l}</div>
              <div style={{fontFamily:D.mono,fontSize:"11px",fontWeight:600,color:c}}>{v}</div>
            </div>
          ))}
        </div>
        {p.history&&<div style={{marginTop:"10px",fontFamily:D.body,fontSize:"10px",color:D.textMuted,background:D.surf3,padding:"7px 10px",borderRadius:D.sm}}>📊 {p.history}</div>}
        {p.lastRolled&&<div style={{marginTop:"6px",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Last rolled: {p.lastRolled}</div>}
      </div>
    );
  };

  return (
    <div className="os-page">
      <SectionHeader title="Fields & Pitch Profiles" sub="Ground management, pitch preparation and surface data" color={D.teal}
        actions={canEdit&&<Btn size="sm">+ Pitch Report</Btn>}/>

      <div style={{display:"grid",gridTemplateColumns:"var(--g-side-l,200px 1fr)",gap:"16px",alignItems:"start"}}>
        {/* Ground list */}
        <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
          {GROUNDS.map(g=>(
            <button key={g.id} onClick={()=>{setSelGround(g);setSelPitch(0);setTab("overview");}} className="pressBtn" style={{
              width:"100%",padding:"10px 12px",borderRadius:D.md,cursor:"pointer",textAlign:"left",
              border:`1px solid ${selGround.id===g.id?D.teal+"55":D.border}`,
              background:selGround.id===g.id?D.teal+"10":D.surf1,
            }}>
              <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:selGround.id===g.id?600:400,color:selGround.id===g.id?D.textPrimary:D.textSecondary,marginBottom:"3px"}}>{g.shortName||g.name}</div>
              <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
                <Badge color={g.type==="turf"?D.emerald:g.type==="nets"?D.sky:D.amber}>{g.type}</Badge>
                <Badge color={g.available?D.emerald:D.rose}>{g.available?"Open":"Closed"}</Badge>
              </div>
            </button>
          ))}
        </div>

        {/* Ground detail */}
        <div>
          {/* Header card */}
          <Card sx={{padding:"16px",marginBottom:"14px",background:`linear-gradient(135deg,${D.teal}08,${D.surf1})`}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"12px",flexWrap:"wrap"}}>
              <div>
                <div style={{fontFamily:D.head,fontSize:"18px",fontWeight:800,color:D.textPrimary,marginBottom:"4px"}}>{selGround.name}</div>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"8px"}}>
                  <Badge color={D.teal}>{selGround.type}</Badge>
                  <Badge color={selGround.available?D.emerald:D.rose}>{selGround.available?"Available":"Unavailable"}</Badge>
                  {selGround.lights&&<Badge color={D.amber}>💡 Lights</Badge>}
                  {selGround.homeTo?.map(t=><Badge key={t} color={D.sky}>{t}</Badge>)}
                </div>
                {selGround.orientation&&<div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>⬡ Orientation: {selGround.orientation}</div>}
                {selGround.dimensions&&<div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>📐 {selGround.dimensions.straight}m straight · {selGround.dimensions.squareLeg}m sq-leg · {selGround.dimensions.squareOff}m sq-off</div>}
              </div>
              {gk&&(
                <div style={{padding:"10px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,minWidth:"150px"}}>
                  <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"6px"}}>GROUNDSKEEPER</div>
                  <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <Avatar name={gk.name} size={28} color={D.teal}/>
                    <div>
                      <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:600,color:D.textPrimary}}>{gk.name.split(" ").slice(-1)[0]}</div>
                      <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{gk.phone}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Tabs */}
          <div style={{display:"flex",gap:"6px",marginBottom:"14px"}}>
            {["overview","pitches","facilities","prep"].filter(t=>selGround.type!=="nets"||["overview","pitches"].includes(t)).map(t=>(
              <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
                padding:"6px 16px",borderRadius:D.pill,cursor:"pointer",textTransform:"capitalize",
                border:`1px solid ${tab===t?D.teal+"55":D.border}`,
                background:tab===t?D.teal+"14":"transparent",
                fontFamily:D.body,fontSize:"11px",fontWeight:tab===t?600:400,
                color:tab===t?D.teal:D.textMuted,
              }}>{t}</button>
            ))}
          </div>

          {tab==="overview"&&(
            <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
              <Card sx={{padding:"14px"}}>
                <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>SURFACE</div>
                {[["Type",selGround.surfaceType||"—"],["Outfield Grade",selGround.outfieldGrade||"N/A"],["Mow Height",selGround.outfieldMowHeight||"N/A"],["Drainage",selGround.drainage||"—"]].map(([l,v])=>(
                  <div key={l} style={{padding:"6px 0",borderBottom:`1px solid ${D.border}`}}>
                    <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"2px"}}>{l}</div>
                    <div style={{fontFamily:D.body,fontSize:"12px",color:D.textPrimary}}>{v}</div>
                  </div>
                ))}
              </Card>
              <Card sx={{padding:"14px"}}>
                <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>PITCH SUMMARY</div>
                {selGround.pitches?.map((p,i)=>(
                  <div key={i} style={{padding:"7px 0",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>Strip {p.num} — {p.surface}</span>
                    <Badge color={condC(p.condition)}>{p.condition}</Badge>
                  </div>
                ))}
                {selGround.capacity&&<div style={{marginTop:"8px",fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>Capacity: {selGround.capacity.toLocaleString()} spectators</div>}
                {selGround.notes&&<div style={{marginTop:"8px",fontFamily:D.body,fontSize:"10px",color:D.textMuted,fontStyle:"italic"}}>{selGround.notes}</div>}
              </Card>
            </div>
          )}

          {tab==="pitches"&&selGround.pitches&&(
            <div>
              <div style={{display:"flex",gap:"6px",marginBottom:"14px"}}>
                {selGround.pitches.map((p,i)=>(
                  <button key={i} onClick={()=>setSelPitch(i)} className="pressBtn" style={{
                    padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",
                    border:`1px solid ${selPitch===i?D.amber+"55":D.border}`,
                    background:selPitch===i?D.amber+"12":"transparent",
                    fontFamily:D.body,fontSize:"11px",color:selPitch===i?D.amber:D.textMuted,
                  }}>Strip {p.num}</button>
                ))}
              </div>
              {pitch&&<PitchVisual p={pitch}/>}
            </div>
          )}

          {tab==="facilities"&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:"10px"}}>
              {Object.entries(selGround.facilities||{}).map(([k,v])=>(
                <div key={k} style={{padding:"10px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,textTransform:"capitalize"}}>{k.replace(/([A-Z])/g," $1")}</span>
                  <span style={{fontFamily:D.mono,fontSize:"12px",color:typeof v==="boolean"?(v?D.emerald:D.textMuted):D.amber,fontWeight:600}}>{typeof v==="boolean"?(v?"✓":"✗"):v}</span>
                </div>
              ))}
              {selGround.equipment&&Object.entries(selGround.equipment).map(([k,v])=>(
                <div key={k} style={{padding:"10px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,textTransform:"capitalize"}}>{k.replace(/([A-Z])/g," $1")}</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.sky}}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {tab==="prep"&&(
            <Card sx={{padding:"16px"}}>
              <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"14px"}}>Preparation Schedule</div>
              {selGround.prepSchedule?(
                <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                  {selGround.prepSchedule.split(".").filter(s=>s.trim()).map((step,i)=>(
                    <div key={i} style={{display:"flex",gap:"10px",alignItems:"flex-start",padding:"9px 12px",background:D.surf2,borderRadius:D.md}}>
                      <div style={{width:"22px",height:"22px",borderRadius:"50%",background:D.teal+"20",border:`1px solid ${D.teal}33`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <span style={{fontFamily:D.mono,fontSize:"10px",color:D.teal,fontWeight:700}}>{i+1}</span>
                      </div>
                      <span style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>{step.trim()}</span>
                    </div>
                  ))}
                </div>
              ):<div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>No preparation schedule set for this facility.</div>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  STAFF VIEW — scorers, medical, drivers, groundskeepers
// ══════════════════════════════════════════════════════
function StaffView({ role }) {
  const [filter, setFilter] = useState("all");
  const [sel, setSel]       = useState(null);
  const canEdit = role==="superadmin"||role==="schooladmin";

  const roleIcon  = r => r==="scorer"?"📋":r==="medical"?"⚕️":r==="driver"?"🚌":r==="groundskeeper"?"🌿":"👤";
  const roleColor = r => ROLES[r]?.color || D.textMuted;
  const filtered  = filter==="all" ? STAFF : STAFF.filter(s=>s.role===filter);

  return (
    <div className="os-page">
      <SectionHeader title="Staff Profiles" sub="Scorers · Medical · Drivers · Groundskeepers" color={D.cyan}
        actions={canEdit&&<Btn size="sm">+ Add Staff</Btn>}/>

      <div style={{display:"flex",gap:"6px",marginBottom:"20px",flexWrap:"wrap"}}>
        {["all","scorer","medical","driver","groundskeeper"].map(f=>(
          <button key={f} onClick={()=>{setFilter(f);setSel(null);}} className="pressBtn" style={{
            padding:"6px 16px",borderRadius:D.pill,cursor:"pointer",textTransform:"capitalize",
            border:`1px solid ${filter===f?(ROLES[f]?.color||D.cyan)+"55":D.border}`,
            background:filter===f?(ROLES[f]?.color||D.cyan)+"14":"transparent",
            fontFamily:D.body,fontSize:"11px",fontWeight:filter===f?600:400,
            color:filter===f?D.textPrimary:D.textMuted,
          }}>{f==="all"?"All Staff":`${roleIcon(f)} ${f.charAt(0).toUpperCase()+f.slice(1)}s`}</button>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:sel?"1fr 360px":"repeat(auto-fill,minmax(260px,1fr))",gap:"14px",alignItems:"start"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:"12px"}}>
          {filtered.map(s=>{
            const rc = ROLES[s.role];
            return (
              <Card key={s.id} onClick={()=>setSel(s)} sx={{
                padding:"16px",cursor:"pointer",
                border:`1px solid ${sel?.id===s.id?roleColor(s.role)+"55":D.border}`,
                background:sel?.id===s.id?roleColor(s.role)+"08":D.surf1,
              }}>
                <div style={{display:"flex",gap:"12px",alignItems:"flex-start",marginBottom:"12px"}}>
                  <div style={{position:"relative"}}>
                    <Avatar name={s.name} size={44} color={roleColor(s.role)}/>
                    <div style={{position:"absolute",bottom:-2,right:-2,width:"14px",height:"14px",borderRadius:"50%",
                      background:s.active?D.emerald:D.rose,border:`2px solid ${D.surf1}`,
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:"7px"}}>
                      {roleIcon(s.role)}
                    </div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginBottom:"2px"}}>{s.name}</div>
                    <Badge color={roleColor(s.role)}>{roleIcon(s.role)} {s.role}</Badge>
                  </div>
                </div>
                <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"8px",lineHeight:1.4}}>
                  {s.experience?.split(".")[0]}.
                </div>
                <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                  <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{s.phone}</span>
                  {s.vehicles&&<Badge color={D.lime}>{s.vehicles.length} vehicle{s.vehicles.length>1?"s":""}</Badge>}
                  {s.teamsAssigned&&<Badge color={D.sky}>{s.teamsAssigned.join(" · ")}</Badge>}
                </div>
              </Card>
            );
          })}
        </div>

        {/* Detail panel */}
        {sel&&(()=>{
          const rc = ROLES[sel.role];
          return (
            <Card sx={{padding:"16px",position:"sticky",top:"16px",maxHeight:"calc(100vh - 100px)",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"16px"}}>
                <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
                  <Avatar name={sel.name} size={48} color={roleColor(sel.role)}/>
                  <div>
                    <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,lineHeight:1.2}}>{sel.name}</div>
                    <div style={{marginTop:"4px",display:"flex",gap:"4px",flexWrap:"wrap"}}>
                      <Badge color={roleColor(sel.role)}>{roleIcon(sel.role)} {sel.role}</Badge>
                      <Badge color={sel.active?D.emerald:D.rose}>{sel.active?"Active":"Inactive"}</Badge>
                    </div>
                  </div>
                </div>
                <button onClick={()=>setSel(null)} style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"16px",flexShrink:0}}>✕</button>
              </div>

              {/* Contact */}
              <div style={{background:D.surf2,borderRadius:D.md,padding:"10px 12px",marginBottom:"12px"}}>
                {[["📞 Phone",sel.phone],["✉️ Email",sel.email],sel.age&&["🎂 Age",`${sel.age} years`]].filter(Boolean).map(([l,v])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${D.border}`}}>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                    <span style={{fontFamily:sel.email&&l.includes("Email")?D.mono:D.body,fontSize:"11px",color:D.textPrimary}}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Qualifications */}
              <div style={{marginBottom:"12px"}}>
                <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"7px"}}>QUALIFICATIONS</div>
                {sel.qualifications?.map(q=>(
                  <div key={q} style={{display:"flex",alignItems:"center",gap:"7px",padding:"4px 0"}}>
                    <div style={{width:"5px",height:"5px",borderRadius:"50%",background:roleColor(sel.role),flexShrink:0}}/>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{q}</span>
                  </div>
                ))}
              </div>

              {/* Experience */}
              <div style={{marginBottom:"12px",background:D.surf2,borderRadius:D.md,padding:"10px 12px"}}>
                <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"6px"}}>EXPERIENCE</div>
                <p style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.5}}>{sel.experience}</p>
              </div>

              {/* Role-specific fields */}
              {sel.role==="scorer"&&(
                <div style={{marginBottom:"12px"}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"7px"}}>SCORING SETUP</div>
                  {[["System",sel.scoringSystem],["Teams",sel.teamsAssigned?.join(", ")],["Languages",sel.languages?.join(", ")],["Availability",sel.availability]].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${D.border}`}}>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,textAlign:"right",maxWidth:"60%"}}>{v}</span>
                    </div>
                  ))}
                  <div style={{marginTop:"8px"}}>
                    <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"5px"}}>EQUIPMENT</div>
                    <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>{sel.equipment?.map(e=><Pill key={e} color={D.orange}>{e}</Pill>)}</div>
                  </div>
                </div>
              )}

              {sel.role==="medical"&&(
                <div style={{marginBottom:"12px"}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"7px"}}>MEDICAL PROFILE</div>
                  {[["Specialisation",sel.specialisation],["Registered",sel.registeredWith],["Availability",sel.availability]].filter(([,v])=>v).map(([l,v])=>(
                    <div key={l} style={{padding:"5px 0",borderBottom:`1px solid ${D.border}`}}>
                      <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{l}</div>
                      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,marginTop:"2px"}}>{v}</div>
                    </div>
                  ))}
                  {sel.concussionProtocol&&(
                    <div style={{marginTop:"8px",background:D.rose+"10",borderRadius:D.sm,padding:"8px 10px",border:`1px solid ${D.rose}22`}}>
                      <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.rose,letterSpacing:"0.08em",marginBottom:"4px"}}>CONCUSSION PROTOCOL</div>
                      <div style={{fontFamily:D.body,fontSize:"10px",color:D.textSecondary}}>{sel.concussionProtocol}</div>
                    </div>
                  )}
                  <div style={{marginTop:"8px"}}>
                    <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"5px"}}>EMERGENCY EQUIPMENT</div>
                    <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>{sel.emergencyEquipment?.map(e=><Pill key={e} color={D.rose}>{e}</Pill>)}</div>
                  </div>
                </div>
              )}

              {sel.role==="driver"&&(
                <div style={{marginBottom:"12px"}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"7px"}}>VEHICLES</div>
                  {sel.vehicles?.map(v=>(
                    <div key={v.reg} style={{padding:"10px 12px",background:D.surf2,borderRadius:D.md,marginBottom:"8px",border:`1px solid ${D.border}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                        <span style={{fontFamily:D.mono,fontSize:"12px",fontWeight:700,color:D.lime}}>{v.reg}</span>
                        <Badge color={v.condition==="Excellent"?D.emerald:v.condition==="Good"?D.sky:D.amber}>{v.condition}</Badge>
                      </div>
                      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{v.type} · {v.capacity} seats</div>
                      <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,marginTop:"3px"}}>Next service: {v.nextService}</div>
                    </div>
                  ))}
                  <div style={{marginTop:"6px"}}>
                    <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"5px"}}>REGULAR ROUTES</div>
                    {sel.regularRoutes?.map(r=>(
                      <div key={r} style={{padding:"4px 0",display:"flex",gap:"7px",alignItems:"center"}}>
                        <span style={{color:D.lime}}>→</span>
                        <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sel.role==="groundskeeper"&&(
                <div style={{marginBottom:"12px"}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"7px"}}>GROUNDS PROFILE</div>
                  {[["Assigned Grounds",sel.groundsAssigned?.map(id=>GROUNDS.find(g=>g.id===id)?.shortName).join(", ")],["Speciality",sel.speciality],["Pitch Prep",sel.pitchPreparation]].filter(([,v])=>v).map(([l,v])=>(
                    <div key={l} style={{padding:"6px 0",borderBottom:`1px solid ${D.border}`}}>
                      <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{l}</div>
                      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,marginTop:"2px"}}>{v}</div>
                    </div>
                  ))}
                  <div style={{marginTop:"8px"}}>
                    <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"5px"}}>EQUIPMENT</div>
                    <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>{sel.equipment?.map(e=><Pill key={e} color={D.teal}>{e}</Pill>)}</div>
                  </div>
                </div>
              )}

              {sel.notes&&(
                <div style={{background:D.amber+"0a",borderRadius:D.md,padding:"9px 12px",border:`1px solid ${D.amber}18`}}>
                  <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.amber,letterSpacing:"0.08em",marginBottom:"4px"}}>NOTES</div>
                  <p style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.5}}>{sel.notes}</p>
                </div>
              )}
            </Card>
          );
        })()}
      </div>
    </div>
  );
}

// patch MatchCentreView to include weather

// ══════════════════════════════════════════════════════
//  MATCH DETAIL — deterministic scorecard synthesis (demo data)
//  Seeded by match id so every open shows the same card.
// ══════════════════════════════════════════════════════
const mulberry32 = seed => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const strSeed = s => { let h = 2166136261; for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

const OPP_POOL = ["T van Rooyen","K Naidoo","M Botha","S Mkhize","J Pretorius","L Govender","D Erasmus","A Zondi","R Pillay","W du Toit","N Cele","B Steyn","C Moodley","P Ngcobo","G Venter","F Hadebe","H Marais","U Dube"];

function teamSquad(teamName){
  const token = (teamName.match(/U\d{2}[A-Z]?/)||[])[0];
  const isHilton = /Hilton/i.test(teamName);
  const own = isHilton && token ? PLAYERS.filter(p=>p.team===token).map(p=>p.name) : [];
  const rng = mulberry32(strSeed(teamName));
  const pool = [...OPP_POOL].sort(()=>rng()-0.5);
  const out = [...own];
  while(out.length<11) out.push(pool[out.length % pool.length]+(own.length?"":""));
  return out.slice(0,11);
}
const parseScore = s => { const [r,w] = String(s).split("/").map(Number); return { runs:r, wkts:isNaN(w)?10:w }; };
const parseBalls = ov => { const [o,b] = String(ov).split(".").map(Number); return o*6 + (b||0); };
const fmtOvOS = b => `${Math.floor(b/6)}${b%6?"."+(b%6):""}`;


// ══════════════════════════════════════════════════════
//  PLAYER PROFILE POPOVER — opened from any player name.
//  Receives an RBAC-filtered record: stripped fields arrive
//  null and are simply not rendered.
// ══════════════════════════════════════════════════════
function skillsFor(p){
  if(SKILLS_MATRIX[p.id]) return { data:SKILLS_MATRIX[p.id], assessed:true };
  // Deterministic demo derivation from season stats until a real assessment exists
  const rng=(()=>{let s=strSeed(p.id);return()=>{s|=0;s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};})();
  const j=(base)=>Math.max(30,Math.min(92,Math.round(base+rng()*14-7)));
  const batBase=Math.min(88,35+(p.avg||20)*0.9), bowlBase=p.wkts>5?70:40;
  return { assessed:false, data:{
    batting:{technique:j(batBase),power:j(batBase-4),footwork:j(batBase-2),running:j(batBase),temperament:j(batBase+2)},
    bowling:{accuracy:j(bowlBase),line:j(bowlBase),variations:j(bowlBase-6),pace:j(bowlBase),stamina:j(bowlBase+2)},
    fielding:{catching:j(66),groundwork:j(64),throwing:j(65),positioning:j(66)},
    fitness:{speed:j(70),agility:j(70),endurance:j(68),strength:j(66)},
  }};
}

function PlayerProfileModal({ player, role, onClose, onFullProfile }){
  if(!player) return null;
  const stripped = can(role,"players","r").deny.length>0;
  const sk = skillsFor(player);
  const canFull = ROLES[role]?.nav.includes("profiles");
  const Stat = ({l,v,c}) => (
    <div style={{flex:1,minWidth:"70px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,padding:"8px 6px",textAlign:"center"}}>
      <div style={{fontFamily:D.mono,fontSize:"15px",fontWeight:700,color:c||D.textPrimary}}>{v??"–"}</div>
      <div style={{fontFamily:D.head,fontSize:"7px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginTop:"2px"}}>{l}</div>
    </div>
  );
  const SkillBar = ({l,v}) => (
    <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"5px"}}>
      <span style={{fontFamily:D.body,fontSize:"10px",color:D.textSecondary,width:"84px",textTransform:"capitalize"}}>{l}</span>
      <div style={{flex:1,height:"5px",borderRadius:D.pill,background:D.surf3,overflow:"hidden"}}>
        <div style={{width:`${v}%`,height:"100%",borderRadius:D.pill,background:v>=75?D.emerald:v>=55?D.indigo:D.amber}}/>
      </div>
      <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,width:"22px",textAlign:"right"}}>{v}</span>
    </div>
  );
  const vitals = [
    player.born&&["Born",player.born], player.hometown&&["Hometown",player.hometown],
    player.houseAtSchool&&["House",player.houseAtSchool], player.height&&["Height",player.height],
    player.weight&&["Weight",player.weight],
    player.batHand&&["Bats",player.batHand==="R"?"Right-hand":"Left-hand"],
    player.bowlArm&&["Bowls",`${player.bowlArm==="R"?"Right":"Left"}-arm ${player.bowlStyle==="F"?"fast":player.bowlStyle==="M"?"medium":"spin"}`],
  ].filter(Boolean);
  const ct = player.careerTotals;
  return (
    <Modal title="Player Profile" onClose={onClose} width="560px">
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"12px"}}>
        <div style={{width:"52px",height:"52px",borderRadius:"50%",background:D.gradMain,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:D.head,fontSize:"17px",fontWeight:800,color:"#fff",flexShrink:0}}>
          {player.name.split(" ").map(w=>w[0]).slice(0,2).join("")}
        </div>
        <div style={{minWidth:0}}>
          <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:800,color:D.textPrimary}}>
            {player.name}{player.cap==="c"&&<span style={{marginLeft:"6px",fontFamily:D.mono,fontSize:"10px",color:D.amber}}>©</span>}
          </div>
          <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginTop:"4px"}}>
            <Pill color={D.indigo}>{player.team}</Pill>
            <Pill color={D.violet}>{player.role}</Pill>
            {player.age&&<Pill color={D.textMuted}>{player.age} yrs</Pill>}
            {player.fitness&&<Pill color={player.fitness==="fit"?D.emerald:D.rose}>{player.fitness}</Pill>}
          </div>
        </div>
      </div>
      {/* Bio */}
      {player.bio&&<div style={{fontFamily:D.body,fontSize:"12px",lineHeight:1.6,color:D.textSecondary,marginBottom:"12px"}}>{player.bio}</div>}
      {/* Vitals — RBAC-stripped fields simply don't render */}
      {vitals.length>0&&(
        <div style={{display:"flex",gap:"10px",flexWrap:"wrap",marginBottom:"12px"}}>
          {vitals.map(([l,v])=>(
            <div key={l}><span style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted}}>{l} </span>
            <span style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary}}>{v}</span></div>
          ))}
        </div>
      )}
      {stripped&&<div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"12px"}}>🔒 Some personal details are hidden for your role.</div>}
      {/* Season + career stats */}
      <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"12px"}}>
        <Stat l="Avg" v={player.avg} c={D.emerald}/>
        <Stat l="SR" v={player.sr} c={D.indigo}/>
        <Stat l="Wkts" v={player.wkts} c={D.rose}/>
        <Stat l="Econ" v={player.econ} c={D.amber}/>
        {ct&&<Stat l="Runs" v={ct.runs}/>}
        {ct&&<Stat l="HS" v={ct.hs}/>}
        {ct&&<Stat l="50s/100s" v={`${ct.fifties}/${ct.hundreds}`}/>}
      </div>
      {/* Recent form */}
      {player.seasonForm&&player.seasonForm.length>0&&(
        <>
          <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginBottom:"6px"}}>Recent form</div>
          <div style={{border:`1px solid ${D.border}`,borderRadius:D.lg,overflow:"hidden",marginBottom:"12px"}}>
            {player.seasonForm.slice(-5).reverse().map((f,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 12px",borderTop:i?`1px solid ${D.border}`:"none"}}>
                <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>vs {f.opp}</span>
                <span style={{display:"flex",gap:"10px",alignItems:"center"}}>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textPrimary}}>{f.runs} runs{f.wkts?` · ${f.wkts}w`:""}</span>
                  <span style={{fontFamily:D.head,fontSize:"9px",fontWeight:800,color:f.result==="W"?D.emerald:D.rose}}>{f.result}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {/* Attributes */}
      <div style={{display:"flex",alignItems:"baseline",gap:"8px",marginBottom:"6px"}}>
        <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted}}>Attributes</div>
        {!sk.assessed&&<span style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>estimated — no coach assessment yet</span>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px",marginBottom:"14px"}}>
        {Object.entries(sk.data).map(([grp,vals])=>(
          <div key={grp} style={{background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.lg,padding:"10px 12px"}}>
            <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:D.textSecondary,marginBottom:"7px"}}>{grp}</div>
            {Object.entries(vals).map(([k,v])=><SkillBar key={k} l={k} v={v}/>)}
          </div>
        ))}
      </div>
      {canFull&&onFullProfile&&(
        <button onClick={()=>onFullProfile(player.id)} className="pressBtn" style={{width:"100%",padding:"11px",borderRadius:D.lg,cursor:"pointer",
          background:D.indigo+"18",border:`1px solid ${D.indigo}44`,color:D.textPrimary,fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.08em"}}>
          OPEN FULL PROFILE →
        </button>
      )}
    </Modal>
  );
}

function ScorecardModal({ match, onClose, role, onNavProfile }){
  const [tab, setTab] = useState(0);
  const [prof, setProf] = useState(null);
  // Name → RBAC-gated profile opener. Opponent (synthetic) names have no
  // profile; roles without players-resource access get no links at all.
  const linkFor = name => {
    if(!can(role,"players","r").allowed) return null;
    const p = PLAYERS.find(x=>x.name===name);
    return p ? ()=>setProf(filterRecord(role,"players",p)) : null;
  };
  const { WormChart, ManhattanChart, BatsmanChart, BowlerChart } = ScorerApp.charts;
  const isLive = match.status!=="complete";
  const seeded = useMemo(()=>{
    const inns=[];
    if(match.scorecard?.home) inns.push({...parseScore(match.scorecard.home.score), balls:parseBalls(match.scorecard.home.overs)});
    if(match.scorecard?.away) inns.push({...parseScore(match.scorecard.away.score), balls:parseBalls(match.scorecard.away.overs)});
    return ScorerApp.seedCompletedMatch({
      matchId: match.id, team1: match.homeTeam, team2: match.awayTeam,
      squad1: teamSquad(match.homeTeam), squad2: teamSquad(match.awayTeam),
      inns: inns.map(x=>({ runs:x.runs, wickets:x.wkts, balls:x.balls })),
      liveLast: isLive,
    });
  },[match.id,isLive]);
  const inn = seeded.innings[tab];
  const comp = COMPETITIONS.find(c=>c.id===match.competition);
  const scorerStaff = STAFF.find(s=>s.id===match.scorerId);
  const extrasSum = i => Object.values(i.extras).reduce((a,b)=>a+b,0);
  const legal = i => i.ballLog.filter(b=>b.type!=="Wd"&&b.type!=="Nb");
  const topBat = i => [...i.batsmen].sort((a,b)=>b.runs-a.runs)[0];
  const topBowl = i => [...i.bowlers].sort((a,b)=>b.wickets-a.wickets||a.runs-b.runs)[0];
  const Row = ({cells, head, hi, onName}) => (
    <div style={{display:"grid",gridTemplateColumns:"minmax(0,2.4fr) 44px 40px 34px 34px 52px",gap:"6px",padding:head?"8px 12px":"9px 12px",
      borderTop:head?"none":`1px solid ${D.border}`,background:head?D.surf2:hi?D.indigo+"0a":"transparent",alignItems:"center"}}>
      {cells.map((c,i)=>(
        <div key={i} style={{fontFamily:i===0?D.body:D.mono,fontSize:head?"9px":i===0?"12px":"11px",
          fontWeight:head?700:i===0?500:400,letterSpacing:head?"0.08em":0,textTransform:head?"uppercase":"none",
          color:head?D.textMuted:i===0?D.textPrimary:D.textSecondary,textAlign:i===0?"left":"right",
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:i===0?"normal":"nowrap"}}>
          {i===0&&onName
            ? <button onClick={onName} className="pressBtn" style={{background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.sky,textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:"3px",textAlign:"left"}}>{c}</button>
            : c}
        </div>
      ))}
    </div>
  );
  const Kpi = ({l,v,c}) => (
    <div style={{flex:1,minWidth:"86px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,padding:"8px 10px",textAlign:"center"}}>
      <div style={{fontFamily:D.mono,fontSize:"15px",fontWeight:700,color:c||D.textPrimary}}>{v}</div>
      <div style={{fontFamily:D.head,fontSize:"7px",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:D.textMuted,marginTop:"2px"}}>{l}</div>
    </div>
  );
  const SecLbl = ({children}) => (
    <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,margin:"14px 0 6px"}}>{children}</div>
  );
  if(!inn) return null;
  const lb = legal(inn);
  const dots = lb.filter(b=>b.type==="run"&&b.value===0).length;
  const bnds = lb.filter(b=>b.value===4||b.value===6).length;
  const tb = topBat(inn), tw = topBowl(inn);
  return (
    <Modal title={isLive?"Live Scorecard & Analysis":"Match Scorecard & Analysis"} onClose={onClose} width="720px">
      {/* Result banner */}
      <div style={{textAlign:"center",marginBottom:"12px"}}>
        <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:800,color:D.textPrimary}}>{match.homeTeam} <span style={{color:D.textMuted,fontSize:"11px"}}>vs</span> {match.awayTeam}</div>
        <div style={{display:"flex",justifyContent:"center",gap:"18px",marginTop:"6px",fontFamily:D.mono,fontSize:"16px",color:D.textPrimary}}>
          {match.scorecard?.home&&<span>{match.scorecard.home.score} <span style={{fontSize:"11px",color:D.textMuted}}>({match.scorecard.home.overs})</span></span>}
          {match.scorecard?.away&&<span>{match.scorecard.away.score} <span style={{fontSize:"11px",color:D.textMuted}}>({match.scorecard.away.overs})</span></span>}
        </div>
        {isLive
          ? <div style={{display:"flex",gap:"6px",justifyContent:"center",alignItems:"center",flexWrap:"wrap",marginTop:"4px"}}>
              <span style={{display:"flex",alignItems:"center",gap:"5px",padding:"3px 10px",borderRadius:D.pill,background:D.emerald+"18",border:`1px solid ${D.emerald}33`,fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",color:D.emerald}}>
                <div className="live-dot"/>IN PROGRESS
              </span>
              {match.result&&<span style={{padding:"3px 10px",borderRadius:D.pill,background:D.sky+"14",border:`1px solid ${D.sky}30`,fontFamily:D.body,fontSize:"11px",color:D.sky}}>⛈ {match.result}</span>}
            </div>
          : match.result&&<Badge color={D.amber}>{match.result}</Badge>}
      </div>
      <div style={{display:"flex",gap:"6px",flexWrap:"wrap",justifyContent:"center",marginBottom:"12px"}}>
        {comp&&<Pill color={D.violet}>🏆 {comp.name}</Pill>}
        <Pill color={D.sky}>📍 {match.venue}</Pill>
        <Pill color={D.textMuted}>📅 {match.date}</Pill>
        {scorerStaff&&<Pill color={D.orange}>📋 {scorerStaff.name}</Pill>}
      </div>
      {/* Match worm — both innings */}
      {seeded.innings.length>1&&(
        <>
          <SecLbl>Match worm</SecLbl>
          <WormChart innings={seeded.innings} curIn={seeded.innings.length-1} match={seeded.cfg}/>
        </>
      )}
      {/* Innings tabs */}
      <div style={{display:"flex",gap:"6px",margin:"14px 0 10px"}}>
        {seeded.innings.map((x,i)=>(
          <button key={i} onClick={()=>setTab(i)} className="pressBtn" style={{flex:1,padding:"7px 10px",borderRadius:D.md,cursor:"pointer",
            background:tab===i?D.indigo+"18":D.surf2,border:`1px solid ${tab===i?D.indigo+"44":D.border}`,
            fontFamily:D.head,fontSize:"10px",fontWeight:700,color:tab===i?D.textPrimary:D.textMuted}}>
            {i+1}ST INN · {x.battingTeam}{!x.complete&&<span style={{color:D.emerald}}> · LIVE</span>}
          </button>
        ))}
      </div>
      {/* Innings analysis KPIs */}
      <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"10px"}}>
        <Kpi l="Run rate" v={((inn.runs/Math.max(1,inn.balls))*6).toFixed(2)} c={D.emerald}/>
        <Kpi l="Dot %" v={`${Math.round(dots/Math.max(1,lb.length)*100)}%`}/>
        <Kpi l="Boundaries" v={bnds} c={D.indigo}/>
        <Kpi l="Top bat" v={tb?`${tb.runs}`:"–"} c={D.amber}/>
        <Kpi l="Best bowl" v={tw?`${tw.wickets}/${tw.runs}`:"–"} c={D.rose}/>
      </div>
      {/* Per-innings charts from the scorer engine */}
      <SecLbl>Runs per over</SecLbl>
      <ManhattanChart inn={inn} match={seeded.cfg}/>
      <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"10px",marginTop:"10px"}}>
        <div><SecLbl>Batting impact</SecLbl><BatsmanChart inn={inn}/></div>
        <div><SecLbl>Bowling economy</SecLbl><BowlerChart inn={inn}/></div>
      </div>
      {/* Batting card */}
      <SecLbl>Batting</SecLbl>
      <div style={{border:`1px solid ${D.border}`,borderRadius:D.lg,overflow:"hidden",marginBottom:"12px"}}>
        <Row head cells={["Batter","R","B","4s","6s","SR"]}/>
        {inn.batsmen.map((b,i)=>(
          <div key={i}>
            <Row hi={b.runs>=50} onName={linkFor(b.name)} cells={[b.name,b.runs,b.balls,b.fours,b.sixes,b.balls?((b.runs/b.balls)*100).toFixed(1):"–"]}/>
            <div style={{padding:"0 12px 7px",fontFamily:D.body,fontSize:"10px",color:b.status==="out"?D.textMuted:D.emerald,marginTop:"-4px"}}>{b.status==="out"?b.dismissal:"not out"}</div>
          </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",padding:"10px 12px",borderTop:`1px solid ${D.borderMed}`,background:D.surf2}}>
          <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>Extras {extrasSum(inn)} (w {inn.extras.wide})</span>
          <span style={{fontFamily:D.mono,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{inn.runs}/{inn.wickets} <span style={{fontSize:"10px",color:D.textMuted}}>({fmtOvOS(inn.balls)} ov{inn.complete?"":", in progress"})</span></span>
        </div>
      </div>
      {inn.fow.length>0&&(
        <div style={{marginBottom:"12px"}}>
          <SecLbl>Fall of wickets</SecLbl>
          <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textSecondary,lineHeight:1.9}}>
            {inn.fow.map((f,i)=>{
              const lk = linkFor(f.batsman);
              return (
                <span key={i}>{i>0&&"  ·  "}{f.runs}/{f.wickets} (
                  {lk?<button onClick={lk} className="pressBtn" style={{background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:D.mono,fontSize:"11px",color:D.sky,textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:"3px"}}>{f.batsman}</button>:f.batsman}
                , {f.overs})</span>
              );
            })}
          </div>
        </div>
      )}
      {prof&&<PlayerProfileModal player={prof} role={role}
        onClose={()=>setProf(null)}
        onFullProfile={onNavProfile?(id)=>{setProf(null);onNavProfile(id);}:null}/>}
      {/* Bowling card */}
      <SecLbl>Bowling</SecLbl>
      <div style={{border:`1px solid ${D.border}`,borderRadius:D.lg,overflow:"hidden"}}>
        <Row head cells={["Bowler","O","M","R","W","Econ"]}/>
        {inn.bowlers.map((bw,i)=>(
          <Row key={i} hi={bw.wickets>=3} onName={linkFor(bw.name)} cells={[bw.name,fmtOvOS(bw.balls),bw.maidens,bw.runs,bw.wickets,(bw.runs/Math.max(1,bw.balls/6)).toFixed(2)]}/>
        ))}
      </div>
    </Modal>
  );
}

function MatchCentreView({ role, onOpenScorer, onNavProfile }) {
  const [filter, setFilter] = useState("all");
  const [selMatch, setSelMatch] = useState(null);
  const [cardM,    setCardM]    = useState(null);
  const filtered = MATCHES.filter(m=>filter==="all"||m.status===filter);
  return (
    <div className="os-page">
      <SectionHeader title="Match Centre" sub="Live scores, results, fixtures & weather" color={D.emerald}
        actions={
          <>
            {(role==="superadmin"||role==="schooladmin"||role==="coach")&&<Btn size="sm" onClick={()=>{}}>+ Schedule Match</Btn>}
            {canScore(role)&&<button onClick={()=>onOpenScorer(null)} className="pressBtn" style={{padding:"5px 12px",borderRadius:D.pill,background:D.emerald+"18",border:`1px solid ${D.emerald}30`,color:D.emerald,fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.05em",cursor:"pointer",display:"flex",alignItems:"center",gap:"5px"}}>
              <div className="live-dot"/>Open SCRBRD Scorer ↗
            </button>}
          </>
        }/>
      <div style={{display:"flex",gap:"6px",marginBottom:"20px"}}>
        {["all","live","upcoming","complete"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} className="pressBtn" style={{
            padding:"5px 14px",borderRadius:D.pill,border:`1px solid ${filter===f?D.indigo+"55":D.border}`,
            background:filter===f?D.indigo+"18":"transparent",cursor:"pointer",
            fontFamily:D.body,fontSize:"11px",fontWeight:filter===f?600:400,
            color:filter===f?D.textPrimary:D.textMuted,textTransform:"capitalize",
          }}>{f}</button>
        ))}
      </div>
      {cardM&&<ScorecardModal match={cardM} role={role} onClose={()=>setCardM(null)} onNavProfile={(id)=>{setCardM(null);onNavProfile&&onNavProfile(id);}}/>}
      <div style={{display:"grid",gridTemplateColumns:selMatch?"var(--g-side-r,1fr 340px)":"1fr",gap:"16px",alignItems:"start"}}>
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          {filtered.map(m=>{
            const comp = COMPETITIONS.find(c=>c.id===m.competition);
            const w = WEATHER[m.id];
            const isLive = m.status==="live";
            const isSel = selMatch?.id===m.id;
            return (
              <Card key={m.id} onClick={()=>setSelMatch(isSel?null:m)} sx={{
                background:isLive?`linear-gradient(135deg,${D.emerald}08,${D.surf1})`:D.surf1,
                border:`1px solid ${isSel?D.sky+"55":isLive?D.emerald+"22":D.border}`,cursor:"pointer",
              }}>
                <div style={{padding:"14px 16px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"10px",flexWrap:"wrap"}}>
                    <StatusDot status={m.status}/>
                    <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:isLive?D.emerald:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase"}}>{m.status}</span>
                    {comp&&<Badge color={D.sky}>{comp.name}</Badge>}
                    {w&&<WeatherChip w={w} compact/>}
                    <span style={{marginLeft:"auto",fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>{m.date}</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:"12px",alignItems:"center"}}>
                    <div>
                      <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:D.textPrimary}}>{m.homeTeam}</div>
                      {m.scorecard?.home&&<div style={{fontFamily:D.mono,fontSize:"18px",fontWeight:500,color:isLive?D.emerald:D.textPrimary,marginTop:"4px"}}>{m.scorecard.home.score} <span style={{fontSize:"12px",color:D.textMuted}}>({m.scorecard.home.overs})</span></div>}
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:800,color:D.textMuted,letterSpacing:"0.06em"}}>VS</div>
                      {m.result&&<div style={{fontFamily:D.body,fontSize:"10px",color:isLive?D.emerald:D.amber,marginTop:"4px",maxWidth:"120px"}}>{m.result}</div>}
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:D.textPrimary}}>{m.awayTeam}</div>
                      {m.scorecard?.away&&<div style={{fontFamily:D.mono,fontSize:"18px",fontWeight:500,color:D.textPrimary,marginTop:"4px"}}>{m.scorecard.away.score} <span style={{fontSize:"12px",color:D.textMuted}}>({m.scorecard.away.overs})</span></div>}
                    </div>
                  </div>
                  <div style={{marginTop:"10px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"6px"}}>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>📍 {m.venue}</span>
                    <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                      {m.transport?.bus&&<Pill color={D.sky}>🚌 Bus {m.transport.depart}</Pill>}
                      {isLive&&canScore(role)&&<Btn size="sm" variant="success" onClick={e=>{e.stopPropagation();onOpenScorer&&onOpenScorer(m);}}>Open Live Scorer →</Btn>}
                      {m.scorecard?.home&&<Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation();setCardM(m);}}>{m.status==="complete"?"Scorecard":"Live Scorecard"}</Btn>}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Match detail with full weather */}
        {selMatch&&(()=>{
          const w = WEATHER[selMatch.id];
          const scorer = selMatch.scorerId ? STAFF.find(s=>s.id===selMatch.scorerId) : null;
          const driver = selMatch.transport?.driverId ? STAFF.find(s=>s.id===selMatch.transport.driverId) : null;
          const ground = selMatch.groundId ? GROUNDS.find(g=>g.id===selMatch.groundId) : null;
          const pitch  = ground?.pitches?.[0];
          return (
            <Card sx={{padding:"16px",position:"sticky",top:"16px",maxHeight:"calc(100vh - 100px)",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"12px"}}>
                <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>Match Details</div>
                <button onClick={()=>setSelMatch(null)} style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"16px"}}>✕</button>
              </div>
              {w&&<div style={{marginBottom:"12px"}}><WeatherChip w={w}/></div>}
              {ground&&pitch&&(
                <div style={{marginBottom:"12px",background:D.surf2,borderRadius:D.md,padding:"10px 12px",border:`1px solid ${D.teal}22`}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.teal,letterSpacing:"0.08em",marginBottom:"7px"}}>PITCH REPORT</div>
                  {[["Ground",ground.shortName],["Strip",`No. ${pitch.num}`],["Surface",pitch.surface],["Condition",pitch.condition],["Bounce",pitch.bounce],["Seam Move",pitch.seamMovement||"—"],["Orientation",ground.orientation]].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${D.border}`}}>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                      <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textPrimary,fontWeight:500}}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
              {scorer&&(
                <div style={{marginBottom:"10px",padding:"9px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.orange}22`,display:"flex",alignItems:"center",gap:"9px"}}>
                  <span style={{fontSize:"16px"}}>📋</span>
                  <div>
                    <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.orange,letterSpacing:"0.06em"}}>SCORER</div>
                    <div style={{fontFamily:D.body,fontSize:"12px",color:D.textPrimary}}>{scorer.name}</div>
                    <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{scorer.scoringSystem}</div>
                  </div>
                </div>
              )}
              {driver&&selMatch.transport?.bus&&(
                <div style={{marginBottom:"10px",padding:"9px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.lime}22`}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.lime,letterSpacing:"0.06em",marginBottom:"5px"}}>TRANSPORT</div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>Driver</span>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary}}>{driver.name}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>Vehicle</span>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.lime}}>{selMatch.transport.vehicle}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>Departs / Returns</span>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.amber}}>{selMatch.transport.depart} / {selMatch.transport.return}</span>
                  </div>
                </div>
              )}
            </Card>
          );
        })()}
      </div>
    </div>
  );
}
function CompetitionsView({ role }) {
  const [active, setActive] = useState("comp1");
  const comp = COMPETITIONS.find(c=>c.id===active);
  return (
    <div className="os-page">
      <SectionHeader title="Competitions" sub="Leagues, cups and tournaments" color={D.amber}
        actions={(role==="superadmin"||role==="schooladmin")&&<Btn size="sm">+ New Competition</Btn>}/>
      <div style={{display:"flex",gap:"8px",marginBottom:"20px",flexWrap:"wrap"}}>
        {COMPETITIONS.map(c=>(
          <button key={c.id} onClick={()=>setActive(c.id)} className="pressBtn" style={{
            padding:"8px 16px",borderRadius:D.md,border:`1px solid ${active===c.id?D.amber+"55":D.border}`,
            background:active===c.id?D.amber+"14":"transparent",cursor:"pointer",textAlign:"left",
          }}>
            <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:active===c.id?600:400,color:active===c.id?D.textPrimary:D.textSecondary}}>{c.name}</div>
            <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginTop:"2px",textTransform:"uppercase"}}>{c.type} · {c.format} · {c.ageGroup}</div>
          </button>
        ))}
      </div>
      {comp&&(
        <div style={{display:"grid",gridTemplateColumns:"var(--g-side-r,1fr 300px)",gap:"16px",alignItems:"start"}}>
          <div>
            <Card sx={{marginBottom:"16px"}}>
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"10px"}}>
                <div style={{flex:1}}>
                  <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary}}>{comp.name}</div>
                  <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginTop:"3px"}}>
                    {comp.format} · {comp.ageGroup} · {comp.teams} teams
                  </div>
                </div>
                <Badge color={comp.active?D.emerald:D.textMuted}>{comp.active?"Active":"Inactive"}</Badge>
                <Badge color={D.sky}>{comp.type}</Badge>
              </div>
              {comp.table&&(
                <div>
                  <div style={{padding:"10px 16px",background:D.surf2,display:"grid",gridTemplateColumns:"var(--g-league,2fr 1fr 1fr 1fr 1fr 1fr 1fr)",gap:"8px"}}>
                    {["Team","P","W","L","NR","Pts","NRR"].map(h=>(
                      <div key={h} style={{fontFamily:D.mono,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.06em",textAlign:h==="Team"?"left":"center"}}>{h}</div>
                    ))}
                  </div>
                  {comp.table.map((t,i)=>(
                    <div key={t.team} style={{padding:"11px 16px",borderTop:`1px solid ${D.border}`,display:"grid",gridTemplateColumns:"var(--g-league,2fr 1fr 1fr 1fr 1fr 1fr 1fr)",gap:"8px",alignItems:"center",background:t.team.includes("Hilton")?D.indigo+"0a":"transparent"}}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                        <span style={{fontFamily:D.mono,fontSize:"12px",fontWeight:700,color:i===0?D.amber:D.textMuted,width:"16px"}}>{i+1}</span>
                        <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:t.team.includes("Hilton")?700:400,color:t.team.includes("Hilton")?D.textPrimary:D.textSecondary}}>{t.team}</span>
                        {i===0&&<span style={{fontSize:"11px"}}>👑</span>}
                      </div>
                      {[t.P,t.W,t.L,t.NR,<span style={{color:t.team.includes("Hilton")?D.emerald:D.textPrimary,fontWeight:700}}>{t.pts}</span>,<span style={{color:t.nrr>=0?D.emerald:D.rose}}>{t.nrr>=0?"+":""}{t.nrr.toFixed(2)}</span>].map((v,j)=>(
                        <div key={j} style={{fontFamily:D.mono,fontSize:"12px",color:D.textSecondary,textAlign:"center"}}>{v}</div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {comp.rounds&&(
                <div style={{padding:"16px"}}>
                  <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textMuted,marginBottom:"12px",letterSpacing:"0.06em",textTransform:"uppercase"}}>Tournament Bracket</div>
                  <div style={{display:"flex",gap:"8px"}}>
                    {comp.rounds.map(r=>(
                      <div key={r} style={{padding:"8px 16px",borderRadius:D.md,background:comp.currentRound===r?D.amber+"18":D.surf2,border:`1px solid ${comp.currentRound===r?D.amber+"44":D.border}`,textAlign:"center"}}>
                        <div style={{fontFamily:D.mono,fontSize:"11px",fontWeight:700,color:comp.currentRound===r?D.amber:D.textMuted}}>{r}</div>
                        {comp.currentRound===r&&<div style={{fontFamily:D.body,fontSize:"9px",color:D.amber,marginTop:"3px"}}>Current</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
            {/* Fixtures for this comp */}
            <SectionHeader title="Fixtures" color={D.amber}/>
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              {MATCHES.filter(m=>m.competition===active).map(m=>(
                <Card key={m.id} sx={{padding:"12px 16px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                    <StatusDot status={m.status}/>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted,flexShrink:0}}>{m.date}</span>
                    <span style={{flex:1,fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{m.homeTeam} vs {m.awayTeam}</span>
                    {m.result&&<span style={{fontFamily:D.body,fontSize:"11px",color:m.result.includes("Hilton")?D.emerald:D.rose}}>{m.result}</span>}
                    {m.status==="upcoming"&&<Badge color={D.sky}>upcoming</Badge>}
                  </div>
                </Card>
              ))}
            </div>
          </div>
          {/* Stats sidebar */}
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            <Card sx={{padding:"14px"}}>
              <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"12px"}}>Hilton Performance</div>
              {[["Matches Played","5"],["Wins","4"],["Losses","1"],["Run Rate","+1.24"],["Highest Score","186/6"],["Lowest Score","142/3"]].map(([l,v])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${D.border}`}}>
                  <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textPrimary,fontWeight:500}}>{v}</span>
                </div>
              ))}
            </Card>
            <Card sx={{padding:"14px"}}>
              <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"12px"}}>Top Performers</div>
              <div style={{marginBottom:"10px"}}>
                <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"6px"}}>BATTING</div>
                {PLAYERS.filter(p=>p.team==="U19A").sort((a,b)=>b.avg-a.avg).slice(0,3).map((p,i)=>(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"6px"}}>
                    <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,width:"14px"}}>{i+1}</span>
                    <Avatar name={p.name} size={24} color={D.sky}/>
                    <span style={{flex:1,fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{p.name.split(" ").pop()}</span>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.amber,fontWeight:500}}>{p.avg}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"6px"}}>BOWLING</div>
                {PLAYERS.filter(p=>p.team==="U19A"&&p.wkts>0).sort((a,b)=>b.wkts-a.wkts).slice(0,3).map((p,i)=>(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"6px"}}>
                    <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,width:"14px"}}>{i+1}</span>
                    <Avatar name={p.name} size={24} color={D.violet}/>
                    <span style={{flex:1,fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{p.name.split(" ").pop()}</span>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.violet,fontWeight:500}}>{p.wkts}wkts</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  SQUAD VIEW
// ══════════════════════════════════════════════════════
function SquadView({ role }) {
  const [team, setTeam]           = useState("U19A");
  const [selected, setSelected]   = useState(null);
  const [addModal, setAddModal]   = useState(false);
  const players = PLAYERS.filter(p=>p.team===team);
  const teams = [...new Set(PLAYERS.map(p=>p.team))];
  const canEdit = role==="superadmin"||role==="schooladmin"||role==="coach";

  const roleColor = r => r==="BAT"?D.sky:r==="BOWL"?D.violet:r==="ALL"?D.emerald:D.amber;
  return (
    <div className="os-page">
      <SectionHeader title="Squad Management" sub="Player rosters, profiles and availability" color={D.sky}
        actions={canEdit&&<Btn size="sm" onClick={()=>setAddModal(true)}>+ Add Player</Btn>}/>
      <div style={{display:"flex",gap:"8px",marginBottom:"20px"}}>
        {teams.map(t=>(
          <button key={t} onClick={()=>{setTeam(t);setSelected(null);}} className="pressBtn" style={{
            padding:"7px 18px",borderRadius:D.pill,border:`1px solid ${team===t?D.sky+"55":D.border}`,
            background:team===t?D.sky+"14":"transparent",cursor:"pointer",
            fontFamily:D.head,fontSize:"12px",fontWeight:700,color:team===t?D.sky:D.textMuted,
          }}>{t}</button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:selected?"1fr 320px":"1fr",gap:"16px"}}>
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:"12px"}}>
            {players.map(p=>(
              <Card key={p.id} onClick={()=>setSelected(p)} sx={{
                padding:"14px",cursor:"pointer",
                border:`1px solid ${selected?.id===p.id?D.sky+"55":p.fitness==="injured"?D.rose+"22":D.border}`,
                background:selected?.id===p.id?D.sky+"08":p.fitness==="injured"?D.rose+"05":D.surf1,
              }}>
                <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
                  <div style={{position:"relative"}}>
                    <Avatar name={p.name} size={40} color={roleColor(p.role)}/>
                    <div style={{position:"absolute",bottom:-2,right:-2,width:"11px",height:"11px",borderRadius:"50%",background:fitnessColor(p.fitness),border:`1.5px solid ${D.surf1}`}}/>
                  </div>
                  <div>
                    <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary,lineHeight:1.2}}>
                      {p.name} {p.cap==="c"?"(c)":p.cap==="vc"?"(vc)":""}
                    </div>
                    <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginTop:"2px"}}>{p.age}y · {p.batHand}HB · {p.bowlArm==="L"?"LA":"RA"}{p.bowlStyle}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"8px"}}>
                  <Badge color={roleColor(p.role)}>{p.role}</Badge>
                  <Badge color={fitnessColor(p.fitness)}>{p.fitness}</Badge>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"4px"}}>
                  <div style={{textAlign:"center",padding:"5px",background:D.surf2,borderRadius:D.sm}}>
                    <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:D.sky}}>{p.avg}</div>
                    <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted}}>avg</div>
                  </div>
                  {p.wkts>0?(
                    <div style={{textAlign:"center",padding:"5px",background:D.surf2,borderRadius:D.sm}}>
                      <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:D.violet}}>{p.wkts}</div>
                      <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted}}>wkts</div>
                    </div>
                  ):(
                    <div style={{textAlign:"center",padding:"5px",background:D.surf2,borderRadius:D.sm}}>
                      <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:D.amber}}>{p.sr}</div>
                      <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted}}>SR</div>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
        {/* Player detail */}
        {selected&&(
          <Card sx={{padding:"16px",position:"sticky",top:"16px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:"14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                <Avatar name={selected.name} size={48} color={roleColor(selected.role)}/>
                <div>
                  <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>{selected.name}</div>
                  <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{selected.team} · Age {selected.age}</div>
                </div>
              </div>
              <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"16px"}}>✕</button>
            </div>
            <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"14px"}}>
              <Badge color={roleColor(selected.role)}>{selected.role}</Badge>
              <Badge color={fitnessColor(selected.fitness)}>{selected.fitness}</Badge>
              <Badge color={selected.batHand==="L"?D.amber:D.sky}>{selected.batHand}HB</Badge>
              <Badge color={selected.bowlArm==="L"?D.violet:D.emerald}>{selected.bowlArm==="L"?"LA":"RA"}{selected.bowlStyle}</Badge>
            </div>
            <div style={{marginBottom:"14px"}}>
              <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"8px"}}>SEASON STATS</div>
              <div style={{display:"grid",gridTemplateColumns:"var(--g-3,1fr 1fr 1fr)",gap:"6px"}}>
                {[["AVG",selected.avg,D.sky],["SR",selected.sr,D.amber],["WKTS",selected.wkts,D.violet],["ECON",selected.econ||"-",D.emerald],["AGE",selected.age,D.textMuted],[selected.cap?"ROLE":"",(selected.cap||"").toUpperCase()||"-",D.amber]].filter(([l])=>l).map(([l,v,c])=>(
                  <div key={l} style={{textAlign:"center",padding:"7px 4px",background:D.surf2,borderRadius:D.sm}}>
                    <div style={{fontFamily:D.mono,fontSize:"14px",fontWeight:500,color:c}}>{v}</div>
                    <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted,marginTop:"2px"}}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{marginBottom:"14px"}}>
              <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"8px"}}>RECENT FORM</div>
              <div style={{display:"flex",gap:"4px"}}>
                {selected.form.map((v,i)=>{
                  const bg = v===0?"rgba(244,63,94,.3)":v>=5?D.amber+"44":v>=3?D.emerald+"33":D.sky+"22";
                  const tc = v===0?D.rose:v>=5?D.amber:v>=3?D.emerald:D.sky;
                  return <div key={i} style={{flex:1,textAlign:"center",padding:"5px 2px",borderRadius:D.sm,background:bg}}>
                    <span style={{fontFamily:D.mono,fontSize:"11px",fontWeight:700,color:tc}}>{v===0?"W":v}</span>
                  </div>;
                })}
              </div>
            </div>
            {SKILLS_MATRIX[selected.id]&&(
              <div>
                <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>SKILLS SNAPSHOT</div>
                <div style={{display:"flex",justifyContent:"center"}}>
                  <RadarChart data={SKILLS_MATRIX[selected.id].batting} color={D.sky} size={140}/>
                </div>
              </div>
            )}
            {canEdit&&(
              <div style={{display:"flex",gap:"6px",marginTop:"14px"}}>
                <Btn size="sm" variant="ghost" onClick={()=>{}}>Edit Profile</Btn>
                <Btn size="sm" variant="ghost" onClick={()=>{}}>Log Injury</Btn>
                <Btn size="sm" variant="ghost" onClick={()=>{}}>Set Availability</Btn>
              </div>
            )}
          </Card>
        )}
      </div>
      {addModal&&(
        <Modal title="Add Player" onClose={()=>setAddModal(false)}>
          <Input label="Full Name" value="" onChange={()=>{}} placeholder="First Last"/>
          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
            <Select label="Team" value="U19A" onChange={()=>{}} options={["U19A","U15A","U13A"]}/>
            <Select label="Role" value="BAT" onChange={()=>{}} options={["BAT","BOWL","ALL","WK"]}/>
            <Select label="Batting Hand" value="R" onChange={()=>{}} options={[{value:"R",label:"Right"},{value:"L",label:"Left"}]}/>
            <Input label="Age" value="" onChange={()=>{}} type="number" placeholder="15"/>
          </div>
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"8px"}}>
            <Btn variant="ghost" onClick={()=>setAddModal(false)}>Cancel</Btn>
            <Btn onClick={()=>setAddModal(false)}>Add Player</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  SKILLS MATRIX VIEW
// ══════════════════════════════════════════════════════
function SkillsView({ role }) {
  const [selPlayer, setSelPlayer] = useState(PLAYERS[0]);
  const [category, setCategory]   = useState("batting");
  const skills = SKILLS_MATRIX[selPlayer.id];
  const canEdit = role==="superadmin"||role==="coach";
  const cats = skills ? Object.keys(skills) : [];
  const SKILL_COLORS = { batting:D.sky, bowling:D.violet, fielding:D.emerald, fitness:D.amber };

  const progressColorForScore = v => v>=80?D.emerald:v>=60?D.sky:v>=40?D.amber:D.rose;

  return (
    <div className="os-page">
      <SectionHeader title="Skills Matrix" sub="Player development tracking & assessment" color={D.violet}
        actions={canEdit&&<Btn size="sm">+ Run Assessment</Btn>}/>
      <div style={{display:"grid",gridTemplateColumns:"var(--g-side-l,220px 1fr)",gap:"16px",alignItems:"start"}}>
        {/* Player list */}
        <Card sx={{padding:"0"}}>
          <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`}}>
            <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em"}}>SELECT PLAYER</div>
          </div>
          <div style={{maxHeight:"calc(100vh - 200px)",overflowY:"auto"}}>
            {PLAYERS.filter(p=>SKILLS_MATRIX[p.id]).map(p=>{
              const s=SKILLS_MATRIX[p.id];
              const overall=Math.round(Object.values(s).flatMap(c=>Object.values(c)).reduce((a,b)=>a+b,0)/Object.values(s).flatMap(c=>Object.values(c)).length);
              return (
                <button key={p.id} onClick={()=>setSelPlayer(p)} className="pressBtn" style={{
                  width:"100%",padding:"10px 14px",display:"flex",alignItems:"center",gap:"9px",
                  background:selPlayer.id===p.id?D.violet+"12":"transparent",
                  border:`1px solid ${selPlayer.id===p.id?D.violet+"33":"transparent"}`,
                  borderRadius:D.md,margin:"1px 5px",width:"calc(100% - 10px)",cursor:"pointer",
                }}>
                  <Avatar name={p.name} size={32} color={selPlayer.id===p.id?D.violet:D.textMuted}/>
                  <div style={{flex:1,textAlign:"left"}}>
                    <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:selPlayer.id===p.id?600:400,color:selPlayer.id===p.id?D.textPrimary:D.textSecondary}}>{p.name.split(" ").pop()}</div>
                    <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{p.team}</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:700,color:progressColorForScore(overall)}}>{overall}</div>
                    <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted}}>OVR</div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Skills detail */}
        <div>
          {/* Header */}
          <Card sx={{padding:"16px",marginBottom:"14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"14px"}}>
              <Avatar name={selPlayer.name} size={52} color={D.violet}/>
              <div style={{flex:1}}>
                <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary}}>{selPlayer.name}</div>
                <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginBottom:"8px"}}>{selPlayer.team} · {selPlayer.role} · {selPlayer.batHand}HB</div>
                <div style={{display:"flex",gap:"6px"}}>
                  <Badge color={D.sky}>{selPlayer.role}</Badge>
                  <Badge color={fitnessColor(selPlayer.fitness)}>{selPlayer.fitness}</Badge>
                </div>
              </div>
              {skills&&(
                <div style={{display:"flex",gap:"10px"}}>
                  {Object.entries(skills).map(([cat,data])=>{
                    const avg=Math.round(Object.values(data).reduce((a,b)=>a+b,0)/Object.values(data).length);
                    return (
                      <div key={cat} style={{textAlign:"center"}}>
                        <div style={{fontFamily:D.mono,fontSize:"18px",fontWeight:700,color:SKILL_COLORS[cat]||D.indigo}}>{avg}</div>
                        <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted,textTransform:"capitalize"}}>{cat}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          {skills?(
            <>
              {/* Category tabs */}
              <div style={{display:"flex",gap:"6px",marginBottom:"16px"}}>
                {cats.map(c=>(
                  <button key={c} onClick={()=>setCategory(c)} className="pressBtn" style={{
                    padding:"7px 16px",borderRadius:D.pill,cursor:"pointer",
                    border:`1px solid ${category===c?(SKILL_COLORS[c]||D.indigo)+"55":D.border}`,
                    background:category===c?(SKILL_COLORS[c]||D.indigo)+"14":"transparent",
                    fontFamily:D.body,fontSize:"12px",fontWeight:category===c?600:400,
                    color:category===c?D.textPrimary:D.textMuted,textTransform:"capitalize",
                  }}>{c}</button>
                ))}
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 180px",gap:"16px"}}>
                <Card sx={{padding:"16px"}}>
                  <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"14px",textTransform:"capitalize"}}>{category} Skills</div>
                  {Object.entries(skills[category]).map(([skill, val])=>(
                    <div key={skill} style={{marginBottom:"14px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"5px"}}>
                        <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textSecondary,textTransform:"capitalize"}}>{skill}</span>
                        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                          <span style={{fontFamily:D.mono,fontSize:"12px",color:progressColorForScore(val),fontWeight:600}}>{val}</span>
                          <Badge color={progressColorForScore(val)}>{val>=80?"Elite":val>=65?"Good":val>=45?"Avg":"Dev"}</Badge>
                        </div>
                      </div>
                      <div style={{width:"100%",height:"8px",background:D.surf3,borderRadius:"4px",overflow:"hidden"}}>
                        <div className="skill-bar" style={{height:"100%",width:`${val}%`,background:`linear-gradient(90deg,${SKILL_COLORS[category]||D.indigo},${progressColorForScore(val)})`,borderRadius:"4px"}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",marginTop:"3px"}}>
                        <span style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted}}>0</span>
                        <span style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted}}>Target: 90</span>
                        <span style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted}}>100</span>
                      </div>
                    </div>
                  ))}
                  {canEdit&&<Btn size="sm" variant="ghost" onClick={()=>{}}>Update Scores</Btn>}
                </Card>
                <div>
                  <Card sx={{padding:"14px",marginBottom:"12px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.06em",marginBottom:"10px"}}>RADAR</div>
                    <div style={{display:"flex",justifyContent:"center"}}>
                      <RadarChart data={skills[category]} color={SKILL_COLORS[category]||D.indigo} size={150}/>
                    </div>
                  </Card>
                  <Card sx={{padding:"14px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.06em",marginBottom:"10px"}}>DEV PLAN</div>
                    {Object.entries(skills[category]).sort(([,a],[,b])=>a-b).slice(0,3).map(([s,v])=>(
                      <div key={s} style={{padding:"7px 0",borderBottom:`1px solid ${D.border}`}}>
                        <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,textTransform:"capitalize",marginBottom:"2px"}}>{s}</div>
                        <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                          <div style={{flex:1,height:"3px",background:D.surf3,borderRadius:"2px",overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${v}%`,background:D.orange,borderRadius:"2px"}}/>
                          </div>
                          <span style={{fontFamily:D.mono,fontSize:"9px",color:D.orange}}>{v}→{Math.min(v+10,100)}</span>
                        </div>
                      </div>
                    ))}
                    <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"8px"}}>Focus areas for next quarter</div>
                  </Card>
                </div>
              </div>
            </>
          ):(
            <Card sx={{padding:"32px",textAlign:"center"}}>
              <div style={{fontSize:"32px",marginBottom:"12px"}}>🎯</div>
              <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted}}>No skills assessment available for this player yet.</div>
              {canEdit&&<div style={{marginTop:"14px"}}><Btn size="sm">Run Assessment</Btn></div>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  TRAINING VIEW
// ══════════════════════════════════════════════════════
function TrainingView({ role }) {
  const [view, setView] = useState("schedule");
  const [addModal, setAddModal] = useState(false);
  const canEdit = role==="superadmin"||role==="coach";

  const DRILLS_LIBRARY = [
    { id:"d1", name:"Throw-Downs",          category:"Batting",  duration:20, desc:"Coach delivers throw-downs to batters — front foot drives focus" },
    { id:"d2", name:"Short-Pitch Defence",   category:"Batting",  duration:15, desc:"Back-foot technique against short ball" },
    { id:"d3", name:"Target Bowling",        category:"Bowling",  duration:25, desc:"Cones placed at good length, bowlers aim for corridors" },
    { id:"d4", name:"Reaction Catches",      category:"Fielding", duration:15, desc:"Coach feeds ball randomly, fielders react" },
    { id:"d5", name:"Long Barrier Ground",   category:"Fielding", duration:20, desc:"Sliding long barrier practice on outfield" },
    { id:"d6", name:"12-3-6 Fitness",        category:"Fitness",  duration:20, desc:"Sprint work — 12 sprints × 3 sets × 6 seconds each" },
    { id:"d7", name:"Wrist Spin Variation",  category:"Bowling",  duration:30, desc:"Leggie/googly/flipper identification and execution drills" },
    { id:"d8", name:"Running Between Wickets",category:"Batting", duration:15, desc:"Calling, turning, sliding — team drill" },
    { id:"d9", name:"Slips Cordon",          category:"Fielding", duration:20, desc:"Edge catching off the catching cradle" },
    { id:"d10",name:"Strength & Conditioning",category:"Fitness", duration:45, desc:"Full S&C programme — gym-based or field-based" },
  ];

  const typeColor = t => t==="Batting"?D.sky:t==="Bowling"?D.violet:t==="Fielding"?D.emerald:t==="fitness"?D.amber:D.orange;

  return (
    <div className="os-page">
      <SectionHeader title="Training" sub="Session planner, drills library & attendance" color={D.emerald}
        actions={
          <div style={{display:"flex",gap:"6px"}}>
            <div style={{display:"flex",background:D.surf2,borderRadius:D.pill,padding:"3px",border:`1px solid ${D.border}`}}>
              {["schedule","drills"].map(v=>(
                <button key={v} onClick={()=>setView(v)} className="pressBtn" style={{
                  padding:"5px 14px",borderRadius:D.pill,border:"none",cursor:"pointer",
                  background:view===v?D.gradLive:"transparent",
                  color:view===v?"#fff":D.textMuted,fontFamily:D.head,fontSize:"10px",fontWeight:700,
                  letterSpacing:"0.06em",textTransform:"capitalize",
                }}>{v}</button>
              ))}
            </div>
            {canEdit&&<Btn size="sm" onClick={()=>setAddModal(true)}>+ Session</Btn>}
          </div>
        }/>

      {view==="schedule"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          {TRAINING_SESSIONS.map(s=>{
            const coach = COACHES.find(c=>c.id===s.coach);
            const typeCol = s.type==="batting"?D.sky:s.type==="bowling"||s.type==="skills"?D.violet:s.type==="fitness"?D.amber:D.emerald;
            const isToday = s.date===dateStr(today);
            return (
              <Card key={s.id} sx={{border:`1px solid ${isToday?D.emerald+"33":D.border}`,background:isToday?D.emerald+"05":D.surf1}}>
                <div style={{padding:"14px 16px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
                    <div style={{width:"48px",textAlign:"center",flexShrink:0,padding:"6px",background:typeCol+"14",borderRadius:D.md,border:`1px solid ${typeCol}22`}}>
                      <div style={{fontFamily:D.mono,fontSize:"15px",fontWeight:700,color:typeCol}}>{new Date(s.date).getDate()}</div>
                      <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted,textTransform:"uppercase"}}>{new Date(s.date).toLocaleString("en",{month:"short"})}</div>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"3px"}}>
                        <span style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>{s.title}</span>
                        {isToday&&<Badge color={D.emerald}>Today</Badge>}
                        <Badge color={typeCol}>{s.type}</Badge>
                      </div>
                      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>
                        {s.team} · {s.time} · {s.duration}min · {s.venue} · {coach?.name||"Coach"}
                      </div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontFamily:D.mono,fontSize:"16px",fontWeight:700,color:D.amber}}>{s.attendance.length}</div>
                      <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>attending</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"8px"}}>
                    {s.drills.map(d=><Pill key={d} color={typeCol}>{d}</Pill>)}
                  </div>
                  {s.notes&&<div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,fontStyle:"italic",background:D.surf2,padding:"7px 10px",borderRadius:D.sm}}>📝 {s.notes}</div>}
                  <div style={{display:"flex",gap:"4px",marginTop:"10px"}}>
                    {s.attendance.map(pid=>{
                      const p=PLAYERS.find(pl=>pl.id===pid);
                      return p?<div key={pid} title={p.name}><Avatar name={p.name} size={24} color={D.emerald}/></div>:null;
                    })}
                    {canEdit&&<button style={{width:"24px",height:"24px",borderRadius:"50%",background:D.surf3,border:`1px dashed ${D.border}`,cursor:"pointer",color:D.textMuted,fontSize:"12px",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {view==="drills"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:"12px"}}>
            {DRILLS_LIBRARY.map(d=>(
              <Card key={d.id} sx={{padding:"14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px"}}>
                  <span style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{d.name}</span>
                  <Badge color={typeColor(d.category)}>{d.category}</Badge>
                </div>
                <p style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,lineHeight:1.5,marginBottom:"10px"}}>{d.desc}</p>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <Pill color={typeColor(d.category)}>⏱ {d.duration}min</Pill>
                  {canEdit&&<button style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.sky}}>Add to session</button>}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {addModal&&(
        <Modal title="Schedule Training Session" onClose={()=>setAddModal(false)}>
          <Input label="Session Title" value="" onChange={()=>{}} placeholder="e.g. Pre-Match Batting Practice"/>
          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
            <Select label="Team" value="U19A" onChange={()=>{}} options={["U19A","U15A","U13A"]}/>
            <Select label="Type" value="batting" onChange={()=>{}} options={["batting","bowling","fielding","fitness","skills","technical"]}/>
            <Input label="Date" value="" onChange={()=>{}} type="date"/>
            <Input label="Time" value="" onChange={()=>{}} type="time"/>
            <Input label="Duration (min)" value="" onChange={()=>{}} type="number" placeholder="90"/>
            <Select label="Venue" value="Nets 1-3" onChange={()=>{}} options={["Nets 1-3","Nets 4-5","Nets 6-7","Main Field","No.1 Ground"]}/>
          </div>
          <Input label="Notes" value="" onChange={()=>{}} placeholder="Session objectives and focus areas..."/>
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"8px"}}>
            <Btn variant="ghost" onClick={()=>setAddModal(false)}>Cancel</Btn>
            <Btn onClick={()=>setAddModal(false)}>Create Session</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  INJURIES VIEW
// ══════════════════════════════════════════════════════
function InjuryView({ role }) {
  const [addModal, setAddModal] = useState(false);
  const [sel, setSel] = useState(null);
  const canEdit = can(role,"injuries","update").allowed;
  const injV = getData("injuries", principalForRole(role));

  return (
    <div className="os-page">
      <SectionHeader title="Injury Management" sub="Tracker, return-to-play & rehab status" color={D.rose}
        actions={canEdit&&<Btn size="sm" onClick={()=>setAddModal(true)}>+ Log Injury</Btn>}/>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"12px",marginBottom:"24px"}}>
        <KPICard label="Active Injuries" value={injV.filter(i=>i.restricted).length}  icon="🏥" color={D.rose}/>
        <KPICard label="In Rehab"        value={injV.filter(i=>i.phase==="Reconditioning"||i.phase==="Strengthening").length} icon="💪" color={D.orange}/>
        <KPICard label="Returning Soon"  value={injV.filter(i=>{const d=(new Date(i.rtw)-today)/(1000*60*60*24);return d>=0&&d<=7;}).length} icon="✅" color={D.amber}/>
        <KPICard label="Available"       value={PLAYERS.filter(p=>p.fitness==="fit").length} icon="👟" color={D.emerald}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"var(--g-side-r,1fr 340px)",gap:"16px",alignItems:"start"}}>
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          {injV.map(inj=>{
            const player = PLAYERS.find(p=>p.id===inj.player);
            const pct = pctDays(inj.dateInj, inj.rtw);
            const daysLeft = Math.max(0,Math.ceil((new Date(inj.rtw)-today)/(1000*60*60*24)));
            const sc = severityColor(inj.severity);
            return (
              <Card key={inj.id} onClick={()=>setSel(inj)} sx={{
                cursor:"pointer",padding:"14px 16px",
                border:`1px solid ${sel?.id===inj.id?sc+"55":D.border}`,
                background:sel?.id===inj.id?sc+"06":D.surf1,
              }}>
                <div style={{display:"flex",gap:"12px",alignItems:"flex-start"}}>
                  <Avatar name={player?.name||"?"} size={40} color={sc}/>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px"}}>
                      <span style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{player?.name}</span>
                      <Badge color={sc}>{inj.severity}</Badge>
                      <Badge color={inj.restricted?D.rose:D.emerald}>{inj.restricted?"Restricted":"Cleared"}</Badge>
                    </div>
                    <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:sc,marginBottom:"4px"}}>{inj.type}</div>
                    <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"8px"}}>
                      Phase: <span style={{color:D.textSecondary,fontWeight:500}}>{inj.phase}</span> · Physio: {inj.physio}
                    </div>
                    <div style={{marginBottom:"4px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                        <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Recovery progress</span>
                        <span style={{fontFamily:D.mono,fontSize:"10px",color:sc,fontWeight:600}}>{pct}%</span>
                      </div>
                      <ProgressBar pct={pct} color={sc} height={6}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between"}}>
                      <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>Injured: {inj.dateInj}</span>
                      <span style={{fontFamily:D.body,fontSize:"10px",color:daysLeft<=3?D.emerald:D.textMuted}}>RTW: {inj.rtw} {daysLeft===0?"TODAY":daysLeft<=3?`(${daysLeft}d)`:""}</span>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Detail panel */}
        {sel&&(()=>{
          const player = PLAYERS.find(p=>p.id===sel.player);
          const sc = severityColor(sel.severity);
          const pct = pctDays(sel.dateInj, sel.rtw);
          const daysLeft = Math.max(0,Math.ceil((new Date(sel.rtw)-today)/(1000*60*60*24)));
          return (
            <Card sx={{padding:"16px",position:"sticky",top:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"16px"}}>
                <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>Injury Report</div>
                <button onClick={()=>setSel(null)} style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"16px"}}>✕</button>
              </div>
              <div style={{textAlign:"center",padding:"16px",background:sc+"10",borderRadius:D.md,border:`1px solid ${sc}22`,marginBottom:"14px"}}>
                <Avatar name={player?.name||"?"} size={56} color={sc}/>
                <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:D.textPrimary,marginTop:"10px"}}>{player?.name}</div>
                <div style={{fontFamily:D.body,fontSize:"12px",color:sc,marginTop:"3px",fontWeight:500}}>{sel.type}</div>
                <Badge color={sc} style={{marginTop:"6px"}}>{sel.severity}</Badge>
              </div>

              {[["Phase",sel.phase],["Physio",sel.physio],["Date Injured",sel.dateInj],["Est. RTW",sel.rtw],["Days Remaining",`${daysLeft} days`]].map(([l,v])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${D.border}`}}>
                  <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:l==="Days Remaining"&&daysLeft<=3?D.emerald:D.textPrimary,fontWeight:500}}>{v}</span>
                </div>
              ))}

              <div style={{marginTop:"12px",marginBottom:"12px"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:"6px"}}>
                  <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.06em"}}>RECOVERY</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:sc}}>{pct}%</span>
                </div>
                <ProgressBar pct={pct} color={sc} height={8}/>
              </div>

              <div style={{background:D.surf2,borderRadius:D.md,padding:"10px 12px",marginBottom:"12px"}}>
                <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"6px"}}>CLINICAL NOTES</div>
                <p style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.5}}>{sel.notes}</p>
              </div>

              {canEdit&&(
                <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                  <Btn size="sm" variant="success" onClick={()=>{}}>Update Progress</Btn>
                  <Btn size="sm" variant="ghost" onClick={()=>{}}>Clear for Training</Btn>
                  <Btn size="sm" variant="ghost" onClick={()=>{}}>Refer to Physio</Btn>
                </div>
              )}
            </Card>
          );
        })()}
      </div>

      {addModal&&(
        <Modal title="Log Injury" onClose={()=>setAddModal(false)}>
          <Select label="Player" value="" onChange={()=>{}} options={PLAYERS.map(p=>({value:p.id,label:`${p.name} (${p.team})`}))}/>
          <Input label="Injury Type" value="" onChange={()=>{}} placeholder="e.g. Hamstring Strain"/>
          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
            <Select label="Severity" value="mild" onChange={()=>{}} options={["mild","moderate","severe"]}/>
            <Select label="Phase" value="Initial" onChange={()=>{}} options={["Immobilisation","Reconditioning","Strengthening","Return to bowl","Return to bat","Cleared"]}/>
            <Input label="Date Injured" value="" onChange={()=>{}} type="date"/>
            <Input label="Est. Return to Play" value="" onChange={()=>{}} type="date"/>
            <Input label="Physio" value="" onChange={()=>{}} placeholder="Dr Smith"/>
          </div>
          <Input label="Clinical Notes" value="" onChange={()=>{}} placeholder="Describe the injury and treatment plan..."/>
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"8px"}}>
            <Btn variant="ghost" onClick={()=>setAddModal(false)}>Cancel</Btn>
            <Btn style={{background:D.rose+"18",border:`1px solid ${D.rose}33`,color:D.rose}} onClick={()=>setAddModal(false)}>Log Injury</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  ANALYTICS VIEW
// ══════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════
//  FIXTURE CALENDAR VIEW
// ══════════════════════════════════════════════════════
function CalendarView({ role, onNav }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [selDay,      setSelDay]      = useState(null);

  const base = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year  = base.getFullYear();
  const month = base.getMonth();
  const monthName = base.toLocaleString("en-ZA", { month:"long", year:"numeric" });

  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Bucket matches + sessions by date string
  const byDate = {};
  MATCHES.forEach(m => {
    if (!byDate[m.date]) byDate[m.date] = [];
    byDate[m.date].push({ kind:"match", ...m });
  });
  TRAINING_SESSIONS.forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push({ kind:"session", ...s });
  });

  const cellDate = n => `${year}-${String(month+1).padStart(2,"0")}-${String(n).padStart(2,"0")}`;
  const todayStr = dateStr(today);

  const EventDot = ({ kind, status, type }) => {
    const col = kind==="match"
      ? (status==="live"?D.emerald:status==="complete"?D.textMuted:D.sky)
      : (type==="fitness"?D.amber:type==="batting"?D.sky:type==="skills"?D.violet:D.emerald);
    return <div style={{ width:6, height:6, borderRadius:"50%", background:col, flexShrink:0 }}/>;
  };

  const selEvents = selDay ? (byDate[selDay] || []) : [];

  return (
    <div className="os-page">
      <SectionHeader title="Fixture Calendar" sub="Matches, training sessions and school schedule" color={D.sky}
        actions={
          <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
            <button onClick={()=>setMonthOffset(o=>o-1)} className="pressBtn" style={{background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,padding:"5px 12px",cursor:"pointer",color:D.textSecondary,fontSize:"14px"}}>‹</button>
            <span style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary,minWidth:"160px",textAlign:"center"}}>{monthName}</span>
            <button onClick={()=>setMonthOffset(o=>o+1)} className="pressBtn" style={{background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,padding:"5px 12px",cursor:"pointer",color:D.textSecondary,fontSize:"14px"}}>›</button>
            <button onClick={()=>setMonthOffset(0)} className="pressBtn" style={{background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.pill,padding:"5px 14px",cursor:"pointer",color:D.textMuted,fontFamily:D.body,fontSize:"11px"}}>Today</button>
          </div>
        }/>

      {/* Legend */}
      <div style={{display:"flex",gap:"14px",marginBottom:"16px",flexWrap:"wrap"}}>
        {[["Match – Live",D.emerald],["Match – Upcoming",D.sky],["Match – Complete",D.textMuted],["Training",D.violet]].map(([l,c])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:"6px"}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:c}}/>
            <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:selDay?"var(--g-side-r,1fr 300px)":"1fr",gap:"16px",alignItems:"start"}}>
        <Card sx={{padding:"0",overflow:"hidden"}}>
          {/* Day headers */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:D.surf2,borderBottom:`1px solid ${D.border}`}}>
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>(
              <div key={d} style={{padding:"10px 4px",textAlign:"center",fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.06em"}}>{d}</div>
            ))}
          </div>
          {/* Calendar grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
            {/* Leading blanks */}
            {Array.from({length:firstDow}).map((_,i)=>(
              <div key={`b${i}`} style={{minHeight:"80px",borderRight:`1px solid ${D.border}`,borderBottom:`1px solid ${D.border}`,background:D.surf2+"44"}}/>
            ))}
            {/* Day cells */}
            {Array.from({length:daysInMonth},(_,i)=>i+1).map(day=>{
              const ds = cellDate(day);
              const events = byDate[ds] || [];
              const isToday = ds === todayStr;
              const isSel   = ds === selDay;
              const hasLive = events.some(e=>e.status==="live");
              return (
                <div key={day} onClick={()=>setSelDay(isSel?null:ds)}
                  style={{
                    minHeight:"80px", padding:"6px", cursor:events.length?"pointer":"default",
                    borderRight:`1px solid ${D.border}`, borderBottom:`1px solid ${D.border}`,
                    background: isSel ? D.sky+"12" : hasLive ? D.emerald+"06" : "transparent",
                    transition:"background .15s",
                  }}>
                  <div style={{
                    width:"22px", height:"22px", borderRadius:"50%",
                    background: isToday ? D.indigo : "transparent",
                    display:"flex", alignItems:"center", justifyContent:"center", marginBottom:"4px",
                  }}>
                    <span style={{fontFamily:D.mono,fontSize:"11px",fontWeight:isToday?700:400,color:isToday?"#fff":D.textSecondary}}>{day}</span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
                    {events.slice(0,3).map((ev,i)=>{
                      const col = ev.kind==="match"
                        ? (ev.status==="live"?D.emerald:ev.status==="complete"?D.textMuted:D.sky)
                        : D.violet;
                      const label = ev.kind==="match"
                        ? ev.awayTeam.split(" ").slice(-2).join(" ")
                        : ev.title;
                      return (
                        <div key={i} style={{
                          padding:"1px 5px", borderRadius:"3px",
                          background:col+"20", border:`1px solid ${col}30`,
                          display:"flex", alignItems:"center", gap:"3px",
                        }}>
                          <div style={{width:4,height:4,borderRadius:"50%",background:col,flexShrink:0}}/>
                          <span style={{fontFamily:D.body,fontSize:"9px",color:col,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"68px"}}>{label}</span>
                        </div>
                      );
                    })}
                    {events.length>3&&<span style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted}}>+{events.length-3} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Day detail panel */}
        {selDay&&(
          <Card sx={{padding:"16px",position:"sticky",top:"16px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
              <div>
                <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>
                  {new Date(selDay+"T12:00").toLocaleDateString("en-ZA",{weekday:"long",day:"numeric",month:"long"})}
                </div>
                <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{selEvents.length} event{selEvents.length!==1?"s":""}</div>
              </div>
              <button onClick={()=>setSelDay(null)} style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"16px"}}>✕</button>
            </div>
            {selEvents.length===0&&(
              <div style={{textAlign:"center",padding:"24px",color:D.textMuted,fontFamily:D.body,fontSize:"12px"}}>No events on this day.</div>
            )}
            {selEvents.map((ev,i)=>{
              if (ev.kind==="match") {
                const w = WEATHER[ev.id];
                return (
                  <div key={i} style={{marginBottom:"12px",padding:"12px",background:ev.status==="live"?D.emerald+"0a":D.surf2,borderRadius:D.md,border:`1px solid ${ev.status==="live"?D.emerald+"33":D.border}`}}>
                    <div style={{display:"flex",gap:"6px",marginBottom:"8px",flexWrap:"wrap"}}>
                      <Badge color={ev.status==="live"?D.emerald:ev.status==="complete"?D.textMuted:D.sky}>{ev.status}</Badge>
                      <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>🏏 Match</span>
                    </div>
                    <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary,marginBottom:"3px"}}>{ev.homeTeam}</div>
                    <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"3px"}}>vs {ev.awayTeam}</div>
                    <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"8px"}}>📍 {ev.venue}</div>
                    {w&&<WeatherChip w={w} compact/>}
                    {ev.transport?.bus&&(
                      <div style={{marginTop:"6px",fontFamily:D.mono,fontSize:"10px",color:D.lime}}>🚌 Bus {ev.transport.depart}</div>
                    )}
                  </div>
                );
              }
              const typeCol = ev.type==="batting"?D.sky:ev.type==="bowling"||ev.type==="skills"?D.violet:ev.type==="fitness"?D.amber:D.emerald;
              return (
                <div key={i} style={{marginBottom:"12px",padding:"12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${typeCol}22`}}>
                  <div style={{display:"flex",gap:"6px",marginBottom:"6px"}}>
                    <Badge color={typeCol}>{ev.type}</Badge>
                    <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>💪 Training</span>
                  </div>
                  <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary,marginBottom:"3px"}}>{ev.title}</div>
                  <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{ev.team} · {ev.time} · {ev.duration}min</div>
                  <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>📍 {ev.venue}</div>
                </div>
              );
            })}
          </Card>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  LOGISTICS VIEW  — full overhaul
// ══════════════════════════════════════════════════════
function LogisticsView({ role }) {
  const [tab,       setTab]       = useState("transport");
  const [manifest,  setManifest]  = useState(null);
  const canEdit = role==="superadmin"||role==="schooladmin"||role==="driver";

  const EQUIPMENT_INVENTORY = [
    { id:"eq1",  name:"Match Balls (Dukes)",      category:"Cricket",   qty:24, condition:"Good",      location:"Equipment Room A", lastAudit:"2025-02-01" },
    { id:"eq2",  name:"Practice Balls (White)",    category:"Cricket",   qty:48, condition:"Mixed",     location:"Equipment Room A", lastAudit:"2025-02-01" },
    { id:"eq3",  name:"Batting Helmets (Adult)",   category:"Protective",qty:12, condition:"Good",      location:"Equipment Room A", lastAudit:"2025-01-15" },
    { id:"eq4",  name:"Batting Helmets (Junior)",  category:"Protective",qty:8,  condition:"Fair",      location:"Equipment Room A", lastAudit:"2025-01-15" },
    { id:"eq5",  name:"Batting Pads (Full sets)",  category:"Protective",qty:18, condition:"Good",      location:"Equipment Room A", lastAudit:"2025-01-15" },
    { id:"eq6",  name:"Thigh Guards",              category:"Protective",qty:10, condition:"Good",      location:"Equipment Room A", lastAudit:"2025-01-15" },
    { id:"eq7",  name:"Wicket-Keeper Gloves",      category:"Protective",qty:4,  condition:"Good",      location:"Equipment Room A", lastAudit:"2025-01-15" },
    { id:"eq8",  name:"Batting Gloves (pairs)",    category:"Protective",qty:22, condition:"Mixed",     location:"Equipment Room A", lastAudit:"2025-01-15" },
    { id:"eq9",  name:"Stumps (Full sets)",        category:"Cricket",   qty:6,  condition:"Excellent", location:"Equipment Room B", lastAudit:"2025-01-10" },
    { id:"eq10", name:"Boundary Rope (80m)",       category:"Ground",    qty:3,  condition:"Good",      location:"Equipment Room B", lastAudit:"2025-01-10" },
    { id:"eq11", name:"Sight Screens",             category:"Ground",    qty:4,  condition:"Good",      location:"No.1 Ground",      lastAudit:"2025-01-10" },
    { id:"eq12", name:"Pitch Covers",              category:"Ground",    qty:2,  condition:"Good",      location:"No.1 Ground",      lastAudit:"2025-01-10" },
    { id:"eq13", name:"Bowling Machines",          category:"Training",  qty:2,  condition:"Excellent", location:"Net Shed",         lastAudit:"2025-01-20" },
    { id:"eq14", name:"Fielding Cradle",           category:"Training",  qty:1,  condition:"Good",      location:"Net Shed",         lastAudit:"2025-01-20" },
    { id:"eq15", name:"Coaching Cones (sets)",     category:"Training",  qty:8,  condition:"Good",      location:"Coaching Store",   lastAudit:"2025-01-20" },
    { id:"eq16", name:"First Aid Kits",            category:"Safety",    qty:4,  condition:"Stocked",   location:"Medical Room",     lastAudit:"2025-03-01" },
    { id:"eq17", name:"AED Defibrillator",         category:"Safety",    qty:1,  condition:"Certified", location:"Medical Room",     lastAudit:"2025-02-15" },
    { id:"eq18", name:"Ice Packs (reusable)",      category:"Safety",    qty:20, condition:"Good",      location:"Medical Room",     lastAudit:"2025-02-15" },
  ];

  const catColor = c => c==="Cricket"?D.sky:c==="Protective"?D.rose:c==="Ground"?D.teal:c==="Training"?D.violet:D.amber;
  const condColor = c => c==="Excellent"||c==="Stocked"||c==="Certified"?D.emerald:c==="Good"?D.sky:c==="Mixed"||c==="Fair"?D.amber:D.rose;

  const upcomingTransport = MATCHES.filter(m=>m.status==="upcoming"&&m.transport?.bus);

  return (
    <div className="os-page">
      <SectionHeader title="Logistics" sub="Transport, equipment inventory and ground scheduling" color={D.orange}/>

      <div style={{display:"flex",gap:"6px",marginBottom:"20px",flexWrap:"wrap"}}>
        {["transport","equipment","grounds"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
            padding:"6px 18px", borderRadius:D.pill, cursor:"pointer", textTransform:"capitalize",
            border:`1px solid ${tab===t?D.orange+"55":D.border}`,
            background:tab===t?D.orange+"14":"transparent",
            fontFamily:D.body, fontSize:"11px", fontWeight:tab===t?600:400,
            color:tab===t?D.orange:D.textMuted,
          }}>{t}</button>
        ))}
      </div>

      {/* ── TRANSPORT ── */}
      {tab==="transport"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"12px",marginBottom:"20px"}}>
            <KPICard label="Upcoming Away Trips" value={upcomingTransport.length} icon="🚌" color={D.sky}/>
            <KPICard label="Drivers Available"   value={STAFF.filter(s=>s.role==="driver"&&s.active).length} icon="🚌" color={D.lime}/>
            <KPICard label="Total Seats"         value={STAFF.filter(s=>s.role==="driver").flatMap(s=>s.vehicles).reduce((a,v)=>a+v.capacity,0)} icon="💺" color={D.violet}/>
            <KPICard label="Services Due"        value={STAFF.filter(s=>s.role==="driver").flatMap(s=>s.vehicles).filter(v=>{const d=(new Date(v.nextService)-today)/(86400000);return d<=14;}).length} icon="🔧" color={D.amber} sub="Within 14 days"/>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
            {upcomingTransport.map(m=>{
              const driver   = m.transport?.driverId ? STAFF.find(s=>s.id===m.transport.driverId) : null;
              const vehicle  = driver?.vehicles?.find(v=>v.reg===m.transport?.vehicle);
              const comp     = COMPETITIONS.find(c=>c.id===m.competition);
              const w        = WEATHER[m.id];
              const isManifest = manifest?.id===m.id;
              return (
                <Card key={m.id} sx={{border:`1px solid ${D.border}`,overflow:"visible"}}>
                  <div style={{padding:"16px"}}>
                    <div style={{display:"flex",gap:"14px",alignItems:"flex-start",flexWrap:"wrap"}}>
                      {/* Trip info */}
                      <div style={{flex:1,minWidth:"200px"}}>
                        <div style={{display:"flex",gap:"7px",marginBottom:"8px",flexWrap:"wrap"}}>
                          <Badge color={D.sky}>{m.homeTeam.split(" ").pop()}</Badge>
                          {comp&&<Badge color={D.indigo}>{comp.format}</Badge>}
                          {w&&<WeatherChip w={w} compact/>}
                        </div>
                        <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:D.textPrimary,marginBottom:"3px"}}>
                          {m.homeTeam} <span style={{color:D.textMuted,fontSize:"12px",fontWeight:400}}>vs</span> {m.awayTeam}
                        </div>
                        <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginBottom:"2px"}}>📅 {m.date} · 📍 {m.venue}</div>
                      </div>
                      {/* Timing block */}
                      <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                        <div style={{padding:"10px 14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,textAlign:"center",minWidth:"70px"}}>
                          <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"4px"}}>DEPARTS</div>
                          <div style={{fontFamily:D.mono,fontSize:"16px",fontWeight:700,color:D.sky}}>{m.transport.depart}</div>
                        </div>
                        <div style={{padding:"10px 14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,textAlign:"center",minWidth:"70px"}}>
                          <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"4px"}}>RETURNS</div>
                          <div style={{fontFamily:D.mono,fontSize:"16px",fontWeight:700,color:D.emerald}}>{m.transport.return}</div>
                        </div>
                        <div style={{padding:"10px 14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,textAlign:"center",minWidth:"70px"}}>
                          <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"4px"}}>SEATS</div>
                          <div style={{fontFamily:D.mono,fontSize:"16px",fontWeight:700,color:D.amber}}>{m.transport.seats||"?"}</div>
                        </div>
                      </div>
                    </div>

                    {/* Driver + vehicle strip */}
                    {driver&&(
                      <div style={{marginTop:"12px",padding:"10px 14px",background:D.surf2,borderRadius:D.md,display:"flex",gap:"14px",alignItems:"center",flexWrap:"wrap"}}>
                        <div style={{display:"flex",gap:"9px",alignItems:"center"}}>
                          <Avatar name={driver.name} size={32} color={D.lime}/>
                          <div>
                            <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>{driver.name}</div>
                            <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{driver.phone}</div>
                          </div>
                        </div>
                        {vehicle&&(
                          <>
                            <div style={{width:"1px",height:"32px",background:D.border}}/>
                            <div>
                              <div style={{fontFamily:D.mono,fontSize:"12px",fontWeight:700,color:D.lime}}>{vehicle.reg}</div>
                              <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{vehicle.type} · {vehicle.capacity} seats · <span style={{color:condColor(vehicle.condition)}}>{vehicle.condition}</span></div>
                            </div>
                          </>
                        )}
                        <div style={{marginLeft:"auto",display:"flex",gap:"6px"}}>
                          <Btn size="sm" variant="ghost" onClick={()=>setManifest(isManifest?null:m)}>
                            {isManifest?"Close Manifest":"📋 Manifest"}
                          </Btn>
                          {canEdit&&<Btn size="sm" variant="ghost">Edit</Btn>}
                        </div>
                      </div>
                    )}

                    {/* Passenger manifest */}
                    {isManifest&&(()=>{
                      const team = m.homeTeam.includes("U19")?PLAYERS.filter(p=>p.team==="U19A"):m.homeTeam.includes("U15")?PLAYERS.filter(p=>p.team==="U15A"):PLAYERS.filter(p=>p.team==="U13A");
                      const teamCoaches = COACHES.filter(c=>team.some(p=>c.team===p.team));
                      const allPassengers = [...team.map(p=>({name:p.name,type:"Player",team:p.team})), ...teamCoaches.map(c=>({name:c.name,type:"Coach",team:c.team}))];
                      return (
                        <div style={{marginTop:"12px",padding:"14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.teal}22`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                            <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.teal,letterSpacing:"0.08em"}}>TRAVEL MANIFEST — {allPassengers.length} PASSENGERS</div>
                            <Badge color={allPassengers.length<=(m.transport.seats||99)?D.emerald:D.rose}>{allPassengers.length}/{m.transport.seats||"?"} seats</Badge>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"6px"}}>
                            {allPassengers.map((p,i)=>(
                              <div key={i} style={{display:"flex",alignItems:"center",gap:"7px",padding:"6px 8px",background:D.surf1,borderRadius:D.sm}}>
                                <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,width:"16px"}}>{i+1}</span>
                                <Avatar name={p.name} size={22} color={p.type==="Coach"?D.emerald:D.sky}/>
                                <div>
                                  <div style={{fontFamily:D.body,fontSize:"10px",fontWeight:500,color:D.textPrimary,lineHeight:1.2}}>{p.name.split(" ").slice(-1)[0]}</div>
                                  <div style={{fontFamily:D.mono,fontSize:"8px",color:p.type==="Coach"?D.emerald:D.textMuted}}>{p.type}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div style={{marginTop:"10px",fontFamily:D.body,fontSize:"10px",color:D.textMuted,fontStyle:"italic"}}>
                            ⚠ All players must have signed indemnity forms. Medical kit carried by {STAFF.find(s=>s.role==="medical"&&s.active)?.name||"medical staff"}.
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </Card>
              );
            })}
            {upcomingTransport.length===0&&(
              <Card sx={{padding:"32px",textAlign:"center"}}>
                <div style={{fontSize:"32px",marginBottom:"10px"}}>🚌</div>
                <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted}}>No bus trips scheduled for upcoming fixtures.</div>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ── EQUIPMENT ── */}
      {tab==="equipment"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"12px",marginBottom:"20px"}}>
            <KPICard label="Total Line Items"  value={EQUIPMENT_INVENTORY.length} icon="📦" color={D.sky}/>
            <KPICard label="Needs Attention"   value={EQUIPMENT_INVENTORY.filter(e=>e.condition==="Fair"||e.condition==="Mixed").length} icon="⚠️" color={D.amber}/>
            <KPICard label="Match Balls"       value={EQUIPMENT_INVENTORY.find(e=>e.id==="eq1")?.qty||0} icon="🏏" color={D.indigo}/>
            <KPICard label="Safety Items"      value={EQUIPMENT_INVENTORY.filter(e=>e.category==="Safety").length} icon="🏥" color={D.rose}/>
          </div>
          <Card>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{background:D.surf2}}>
                    {["Item","Category","Qty","Condition","Location","Last Audit","Action"].map(h=>(
                      <th key={h} style={{padding:"10px 12px",fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {EQUIPMENT_INVENTORY.map((eq,i)=>(
                    <tr key={eq.id} style={{borderTop:`1px solid ${D.border}`,background:i%2===0?"transparent":D.surf2+"33"}}>
                      <td style={{padding:"10px 12px",fontFamily:D.body,fontSize:"12px",color:D.textPrimary,fontWeight:500}}>{eq.name}</td>
                      <td style={{padding:"10px 12px"}}><Badge color={catColor(eq.category)}>{eq.category}</Badge></td>
                      <td style={{padding:"10px 12px",fontFamily:D.mono,fontSize:"13px",fontWeight:600,color:D.textPrimary,textAlign:"center"}}>{eq.qty}</td>
                      <td style={{padding:"10px 12px"}}><Badge color={condColor(eq.condition)}>{eq.condition}</Badge></td>
                      <td style={{padding:"10px 12px",fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{eq.location}</td>
                      <td style={{padding:"10px 12px",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{eq.lastAudit}</td>
                      <td style={{padding:"10px 12px"}}>
                        {canEdit&&<button style={{background:"none",border:`1px solid ${D.border}`,borderRadius:D.sm,padding:"3px 9px",cursor:"pointer",fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>Edit</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── GROUNDS SCHEDULE ── */}
      {tab==="grounds"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:"12px"}}>
          {GROUNDS.map(g=>{
            const gk = STAFF.find(s=>s.id===g.groundskeeper);
            const todayMatches = MATCHES.filter(m=>m.groundId===g.id&&m.date===dateStr(today));
            const upcomingMatchesG = MATCHES.filter(m=>m.groundId===g.id&&m.status==="upcoming");
            return (
              <Card key={g.id} sx={{padding:"16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px"}}>
                  <div>
                    <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginBottom:"4px"}}>{g.name}</div>
                    <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
                      <Badge color={g.type==="turf"?D.emerald:g.type==="nets"?D.sky:D.amber}>{g.type}</Badge>
                      <Badge color={g.available?D.emerald:D.rose}>{g.available?"Open":"Closed"}</Badge>
                      {g.lights&&<Badge color={D.amber}>💡 Lights</Badge>}
                    </div>
                  </div>
                </div>
                {g.pitches&&(
                  <div style={{marginBottom:"10px"}}>
                    {g.pitches.filter(p=>p.condition!=="Resting"&&p.condition!=="Maintenance").map(p=>(
                      <div key={p.num} style={{padding:"5px 8px",background:D.surf2,borderRadius:D.sm,marginBottom:"4px",display:"flex",justifyContent:"space-between"}}>
                        <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Strip {p.num}</span>
                        <Badge color={p.condition==="Match-ready"?D.emerald:p.condition==="Good"?D.sky:D.amber}>{p.condition}</Badge>
                      </div>
                    ))}
                  </div>
                )}
                {todayMatches.length>0&&<div style={{marginBottom:"8px",padding:"6px 10px",background:D.emerald+"10",borderRadius:D.sm,border:`1px solid ${D.emerald}22`}}><span style={{fontFamily:D.body,fontSize:"11px",color:D.emerald}}>🏏 Match today: {todayMatches[0].homeTeam} vs {todayMatches[0].awayTeam}</span></div>}
                {upcomingMatchesG.length>0&&<div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"8px"}}>Next match: {upcomingMatchesG[0].date}</div>}
                {gk&&(
                  <div style={{display:"flex",alignItems:"center",gap:"7px",marginTop:"8px",paddingTop:"8px",borderTop:`1px solid ${D.border}`}}>
                    <Avatar name={gk.name} size={24} color={D.teal}/>
                    <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{gk.name}</span>
                    <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginLeft:"auto"}}>🌿 GK</span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  ANALYTICS VIEW  — upgraded
// ══════════════════════════════════════════════════════
function AnalyticsView({ role }) {
  const [teamFilter, setTeamFilter] = useState("U19A");
  const [subView,    setSubView]    = useState("performance");
  const players = PLAYERS.filter(p=>p.team===teamFilter);

  const BarChart = ({ data, colorFn, maxVal, height=80, label }) => {
    const mx = maxVal || Math.max(...data.map(d=>d.v), 1);
    return (
      <div>
        {label&&<div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"8px",textTransform:"uppercase"}}>{label}</div>}
        <div style={{display:"flex",gap:"4px",alignItems:"flex-end",height:px(height)}}>
          {data.map((d,i)=>(
            <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",height:"100%",justifyContent:"flex-end"}}>
              <div style={{fontFamily:D.mono,fontSize:"9px",color:colorFn?colorFn(d.v):D.textMuted}}>{d.v}</div>
              <div style={{width:"100%",borderRadius:"3px 3px 0 0",background:colorFn?colorFn(d.v):D.indigo,height:`${(d.v/mx)*100}%`,minHeight:2,opacity:0.85,transition:"height .5s"}}/>
              <div style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted,textAlign:"center",maxWidth:"40px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.l}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Simulated head-to-head vs KZN schools
  const H2H = [
    { opp:"Michaelhouse", P:6,W:4,L:2,lastResult:"Won by 28 runs",   lastDate:"2025-01-18" },
    { opp:"Maritzburg Col",P:4,W:2,L:2,lastResult:"Lost by 5 wkts",  lastDate:"2025-02-05" },
    { opp:"DHS",           P:5,W:3,L:2,lastResult:"Won by 44 runs",   lastDate:"2024-11-15" },
    { opp:"Kearsney",      P:7,W:5,L:2,lastResult:"Rain — No result", lastDate:dateStr(today) },
    { opp:"Glenwood",      P:3,W:3,L:0,lastResult:"Won by 8 wkts",   lastDate:"2024-10-22" },
    { opp:"Westville",     P:2,W:1,L:1,lastResult:"Lost by 3 runs",   lastDate:"2024-09-14" },
  ];

  // Phase analysis
  const PHASES = [
    { phase:"Powerplay (1–6)",    runsFor:52, runsAgainst:48, wktsFor:2,  wktsAgainst:3  },
    { phase:"Middle (7–14)",      runsFor:78, runsAgainst:62, wktsFor:3,  wktsAgainst:4  },
    { phase:"Death (15–20)",      runsFor:56, runsAgainst:44, wktsFor:5,  wktsAgainst:3  },
  ];

  // Season trend data (last 8 matches)
  const SEASON_TREND = [142,186,134,168,194,152,177,142];
  const SEASON_OPP   = [108,152,135,141,156,148,162,null];

  return (
    <div className="os-page">
      <SectionHeader title="Analytics" sub="Performance insights · KZN head-to-head · Phase analysis" color={D.sky}/>
      <div style={{display:"flex",gap:"6px",marginBottom:"16px",flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:"6px"}}>
          {["U19A","U15A","U13A"].map(t=>(
            <button key={t} onClick={()=>setTeamFilter(t)} className="pressBtn" style={{
              padding:"6px 16px",borderRadius:D.pill,border:`1px solid ${teamFilter===t?D.sky+"55":D.border}`,
              background:teamFilter===t?D.sky+"14":"transparent",cursor:"pointer",
              fontFamily:D.head,fontSize:"11px",fontWeight:700,color:teamFilter===t?D.sky:D.textMuted,
            }}>{t}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:"6px",marginLeft:"auto"}}>
          {["performance","phases","h2h","table"].map(v=>(
            <button key={v} onClick={()=>setSubView(v)} className="pressBtn" style={{
              padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",
              border:`1px solid ${subView===v?D.indigo+"55":D.border}`,
              background:subView===v?D.indigo+"14":"transparent",
              fontFamily:D.body,fontSize:"11px",fontWeight:subView===v?600:400,
              color:subView===v?D.textPrimary:D.textMuted,textTransform:"capitalize",
            }}>{v==="h2h"?"Head-to-Head":v.charAt(0).toUpperCase()+v.slice(1)}</button>
          ))}
        </div>
      </div>

      {subView==="performance"&&(
        <>
          {/* Season worm */}
          <Card sx={{padding:"16px",marginBottom:"14px"}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"14px"}}>Season Scores — Last 8 Matches</div>
            <div style={{position:"relative",height:"100px"}}>
              <svg viewBox={`0 0 ${SEASON_TREND.length*60} 100`} style={{width:"100%",height:"100px",overflow:"visible"}}>
                {/* Hilton line */}
                <polyline
                  points={SEASON_TREND.map((v,i)=>`${i*60+30},${100-(v/220)*90}`).join(" ")}
                  fill="none" stroke={D.emerald} strokeWidth="2" strokeLinejoin="round"/>
                {/* Opponent line */}
                <polyline
                  points={SEASON_OPP.filter(v=>v!==null).map((v,i)=>`${i*60+30},${100-(v/220)*90}`).join(" ")}
                  fill="none" stroke={D.rose} strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 3"/>
                {/* Dots */}
                {SEASON_TREND.map((v,i)=>(
                  <g key={i}>
                    <circle cx={i*60+30} cy={100-(v/220)*90} r="4" fill={D.emerald} stroke={D.surf1} strokeWidth="2"/>
                    <text x={i*60+30} y={100-(v/220)*90-8} textAnchor="middle" fontSize="8" fill={D.emerald} fontFamily={D.mono}>{v}</text>
                  </g>
                ))}
                {SEASON_OPP.filter(v=>v!==null).map((v,i)=>(
                  <circle key={i} cx={i*60+30} cy={100-(v/220)*90} r="3" fill={D.rose} stroke={D.surf1} strokeWidth="1.5"/>
                ))}
              </svg>
            </div>
            <div style={{display:"flex",gap:"16px",marginTop:"8px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"6px"}}><div style={{width:20,height:2,background:D.emerald}}/><span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Hilton</span></div>
              <div style={{display:"flex",alignItems:"center",gap:"6px"}}><div style={{width:20,height:2,background:D.rose,borderTop:"2px dashed"+(D.rose)}}/><span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Opposition</span></div>
            </div>
          </Card>
          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"14px",marginBottom:"14px"}}>
            <Card sx={{padding:"16px"}}>
              <BarChart label="Batting Averages"
                data={players.filter(p=>p.avg>0).sort((a,b)=>b.avg-a.avg).slice(0,7).map(p=>({l:p.name.split(" ").pop().slice(0,7),v:p.avg}))}
                colorFn={v=>v>=40?D.emerald:v>=25?D.sky:D.amber}/>
            </Card>
            <Card sx={{padding:"16px"}}>
              <BarChart label="Strike Rates"
                data={players.filter(p=>p.sr>0).sort((a,b)=>b.sr-a.sr).slice(0,7).map(p=>({l:p.name.split(" ").pop().slice(0,7),v:p.sr}))}
                maxVal={200} colorFn={v=>v>=130?D.emerald:v>=100?D.sky:D.orange}/>
            </Card>
            <Card sx={{padding:"16px"}}>
              <BarChart label="Wickets Taken"
                data={players.filter(p=>p.wkts>0).sort((a,b)=>b.wkts-a.wkts).slice(0,7).map(p=>({l:p.name.split(" ").pop().slice(0,7),v:p.wkts}))}
                colorFn={v=>v>=20?D.rose:v>=12?D.violet:D.indigo}/>
            </Card>
            <Card sx={{padding:"16px"}}>
              <BarChart label="Bowling Economy"
                data={players.filter(p=>p.econ>0).sort((a,b)=>a.econ-b.econ).slice(0,7).map(p=>({l:p.name.split(" ").pop().slice(0,7),v:p.econ}))}
                maxVal={12} colorFn={v=>v<=6.5?D.emerald:v<=8?D.amber:D.rose}/>
            </Card>
          </div>
        </>
      )}

      {subView==="phases"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
          {PHASES.map(ph=>{
            const netRPO = ((ph.runsFor - ph.runsAgainst)/8).toFixed(1);
            return (
              <Card key={ph.phase} sx={{padding:"16px"}}>
                <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,marginBottom:"12px"}}>{ph.phase}</div>
                <div style={{display:"grid",gridTemplateColumns:"var(--g-5,1fr 1fr 1fr 1fr 1fr)",gap:"10px"}}>
                  {[
                    ["Runs Scored",    ph.runsFor,          D.emerald],
                    ["Runs Conceded",  ph.runsAgainst,      D.rose],
                    ["Wkts Batting",   `${ph.wktsFor} lost`,D.amber],
                    ["Wkts Bowling",   `${ph.wktsAgainst} taken`,D.violet],
                    ["Net RPO",        netRPO>=0?`+${netRPO}`:netRPO, Number(netRPO)>=0?D.emerald:D.rose],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{textAlign:"center",padding:"10px 6px",background:D.surf2,borderRadius:D.md}}>
                      <div style={{fontFamily:D.mono,fontSize:"18px",fontWeight:700,color:c}}>{v}</div>
                      <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"4px"}}>{l}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:"12px",display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"8px"}}>
                  <div>
                    <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"4px"}}>Batting run rate</div>
                    <ProgressBar pct={Math.min(100,(ph.runsFor/8/12)*100)} color={D.emerald}/>
                    <div style={{fontFamily:D.mono,fontSize:"10px",color:D.emerald,marginTop:"2px"}}>{(ph.runsFor/8).toFixed(1)} RPO</div>
                  </div>
                  <div>
                    <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"4px"}}>Conceded run rate</div>
                    <ProgressBar pct={Math.min(100,(ph.runsAgainst/8/12)*100)} color={D.rose}/>
                    <div style={{fontFamily:D.mono,fontSize:"10px",color:D.rose,marginTop:"2px"}}>{(ph.runsAgainst/8).toFixed(1)} RPO</div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {subView==="h2h"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          <Card sx={{padding:"14px 16px",background:`linear-gradient(135deg,${D.indigo}08,${D.surf1})`,border:`1px solid ${D.indigo}22`}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.indigo,marginBottom:"4px"}}>KZN Rivals — Head-to-Head Record ({teamFilter})</div>
            <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>All-time results vs KZN school opponents</div>
          </Card>
          {H2H.map(r=>{
            const winPct = Math.round((r.W/r.P)*100);
            return (
              <Card key={r.opp} sx={{padding:"14px 16px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"14px",flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:"120px"}}>
                    <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,marginBottom:"3px"}}>{r.opp}</div>
                    <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Last: {r.lastDate} · <span style={{color:r.lastResult.includes("Won")?D.emerald:r.lastResult.includes("Lost")?D.rose:D.amber}}>{r.lastResult}</span></div>
                  </div>
                  <div style={{display:"flex",gap:"8px"}}>
                    {[["P",r.P,D.textMuted],["W",r.W,D.emerald],["L",r.L,D.rose]].map(([l,v,c])=>(
                      <div key={l} style={{textAlign:"center",padding:"7px 10px",background:D.surf2,borderRadius:D.md,minWidth:"36px"}}>
                        <div style={{fontFamily:D.mono,fontSize:"14px",fontWeight:700,color:c}}>{v}</div>
                        <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>{l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{minWidth:"100px"}}>
                    <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"4px"}}>Win rate</div>
                    <ProgressBar pct={winPct} color={winPct>=60?D.emerald:winPct>=40?D.amber:D.rose}/>
                    <div style={{fontFamily:D.mono,fontSize:"10px",color:winPct>=60?D.emerald:winPct>=40?D.amber:D.rose,marginTop:"2px"}}>{winPct}%</div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {subView==="table"&&(
        <Card>
          <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`}}>
            <span style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>Full Squad Stats — {teamFilter}</span>
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:D.surf2}}>
                  {["Player","Role","Hand","Avg","SR","Wkts","Econ","Form","Status"].map(h=>(
                    <th key={h} style={{padding:"9px 12px",fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:h==="Player"?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map((p,i)=>{
                  const rCol = p.role==="BAT"?D.sky:p.role==="BOWL"?D.violet:p.role==="ALL"?D.emerald:D.amber;
                  return (
                    <tr key={p.id} style={{borderTop:`1px solid ${D.border}`,background:i%2===0?"transparent":D.surf2+"44"}}>
                      <td style={{padding:"10px 12px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                          <Avatar name={p.name} size={26} color={rCol}/>
                          <div>
                            <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{p.name}</div>
                            {p.cap&&<span style={{fontFamily:D.mono,fontSize:"9px",color:D.amber}}>({p.cap})</span>}
                          </div>
                        </div>
                      </td>
                      <td style={{padding:"10px 12px",textAlign:"center"}}><Badge color={rCol}>{p.role}</Badge></td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"11px",color:p.batHand==="L"?D.amber:D.sky}}>{p.batHand}HB</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"12px",fontWeight:500,color:p.avg>=40?D.emerald:p.avg>=25?D.sky:D.amber}}>{p.avg}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"12px",color:p.sr>=130?D.emerald:p.sr>=100?D.sky:D.amber}}>{p.sr}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"12px",color:p.wkts>=15?D.rose:p.wkts>=8?D.violet:D.textMuted}}>{p.wkts||"—"}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"12px",color:p.econ&&p.econ<=6.5?D.emerald:p.econ&&p.econ<=8?D.amber:p.econ?D.rose:D.textMuted}}>{p.econ||"—"}</td>
                      <td style={{padding:"10px 12px"}}>
                        <div style={{display:"flex",gap:"2px"}}>
                          {p.form.slice(-5).map((v,j)=>(
                            <div key={j} style={{width:"13px",height:"13px",borderRadius:"2px",background:v===0?D.rose+"55":v>=5?D.amber+"66":D.emerald+"44",display:"flex",alignItems:"center",justifyContent:"center"}}>
                              <span style={{fontFamily:D.mono,fontSize:"7px",color:v===0?D.rose:v>=5?D.amber:D.emerald,fontWeight:700}}>{v===0?"W":v}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td style={{padding:"10px 12px",textAlign:"center"}}><Badge color={fitnessColor(p.fitness)}>{p.fitness}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function NotificationsView({ role }) {
  const [notifs, setNotifs] = useState(NOTIFICATIONS);
  const markAll = () => setNotifs(n=>n.map(x=>({...x,read:true})));
  const unread = notifs.filter(n=>!n.read).length;
  const ic = t => t==="match"?"🏏":t==="injury"?"🏥":t==="training"?"💪":t==="transport"?"🚌":t==="skills"?"🎯":"📢";
  const uc = u => u==="high"?D.rose:u==="medium"?D.amber:D.textMuted;
  return (
    <div className="os-page">
      <SectionHeader title="Notifications" sub={`${unread} unread alerts`} color={D.rose}
        actions={unread>0&&<Btn size="sm" variant="ghost" onClick={markAll}>Mark all read</Btn>}/>
      <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
        {notifs.map(n=>(
          <Card key={n.id} sx={{padding:"14px 16px",background:n.read?"transparent":D.indigo+"08",border:`1px solid ${n.read?D.border:D.indigo+"22"}`}}
            onClick={()=>setNotifs(ns=>ns.map(x=>x.id===n.id?{...x,read:true}:x))}>
            <div style={{display:"flex",gap:"12px",alignItems:"flex-start"}}>
              <div style={{width:"36px",height:"36px",borderRadius:D.md,background:uc(n.urgency)+"18",border:`1px solid ${uc(n.urgency)}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px",flexShrink:0}}>
                {ic(n.type)}
              </div>
              <div style={{flex:1}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"3px"}}>
                  <span style={{fontFamily:D.body,fontSize:"13px",fontWeight:n.read?400:700,color:D.textPrimary}}>{n.title}</span>
                  <div style={{display:"flex",alignItems:"center",gap:"6px",flexShrink:0}}>
                    <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{n.time}</span>
                    {!n.read&&<div style={{width:"7px",height:"7px",borderRadius:"50%",background:uc(n.urgency)}}/>}
                  </div>
                </div>
                <p style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,lineHeight:1.5}}>{n.body}</p>
                <div style={{display:"flex",gap:"5px",marginTop:"6px"}}>
                  <Badge color={uc(n.urgency)}>{n.urgency}</Badge>
                  <Badge color={D.textMuted}>{n.type}</Badge>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  SETTINGS / RBAC VIEW
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  SETTINGS / RBAC VIEW  — updated with new roles
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  PROFILES VIEW  — universal rich profiles
// ══════════════════════════════════════════════════════
function ProfilesView({ role, profileTarget, onClearTarget }) {
  const [cat,     setCat]     = useState("players");   // players | coaches | staff
  const [selId,   setSelId]   = useState(profileTarget || null);
  const [tab,     setTab]     = useState("overview");
  const [teamF,   setTeamF]   = useState("all");

  // Resolve target on first render, then consume it so a later manual
  // visit to Profiles doesn't re-select a stale deep-link target.
  useEffect(()=>{ if(profileTarget&&onClearTarget) onClearTarget(); },[]);
  const selPlayer = filterRecord(role,"players",PLAYERS.find(p=>p.id===selId));
  const selCoach  = filterRecord(role,"profiles",COACHES.find(c=>c.id===selId));
  const selStaff  = filterRecord(role,"profiles",STAFF.find(s=>s.id===selId));
  const selEntity = selPlayer || selCoach || selStaff;

  const handleSelect = (id, category) => {
    setSelId(id);
    setCat(category);
    setTab("overview");
  };

  // ── MiniSparkline ──
  const Spark = ({ data, color=D.emerald, height=28 }) => {
    const max = Math.max(...data, 1);
    const w = 6, gap = 3;
    return (
      <svg width={data.length*(w+gap)} height={height} style={{verticalAlign:"middle"}}>
        {data.map((v,i)=>{
          const h = Math.max(2,(v/max)*height);
          const c = v===0?D.rose:v>=5?D.amber:color;
          return <rect key={i} x={i*(w+gap)} y={height-h} width={w} height={h} rx="1.5" fill={c} opacity={0.85}/>;
        })}
      </svg>
    );
  };

  // ── Stat Box ──
  const StatBox = ({label,value,sub,color=D.textPrimary,big}) => (
    <div style={{textAlign:"center",padding:big?"14px 10px":"10px 8px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`}}>
      <div style={{fontFamily:D.mono,fontSize:big?"22px":"16px",fontWeight:700,color,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginTop:"2px"}}>{sub}</div>}
      <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"4px",lineHeight:1.2}}>{label}</div>
    </div>
  );

  // ── Player Profile Panel ──
  const PlayerProfile = ({p}) => {
    const skills = SKILLS_MATRIX[p.id];
    const inj = INJURIES.find(i=>i.player===p.id);
    const rCol = p.role==="BAT"?D.sky:p.role==="BOWL"?D.violet:p.role==="ALL"?D.emerald:D.amber;
    const tabs = ["overview","career","form","vs opponents","development"];
    const schoolInfo = p.school==="HIL"?"Hilton College":KZN_SCHOOLS.find(s=>s.abbr===p.school)?.name||p.school;

    return (
      <div style={{flex:1,overflowY:"auto"}}>
        {/* Hero header */}
        <div style={{background:`linear-gradient(135deg,${rCol}18,${D.surf1} 60%)`,padding:"24px",borderBottom:`1px solid ${D.border}`}}>
          <div style={{display:"flex",gap:"18px",alignItems:"flex-start",flexWrap:"wrap"}}>
            <div style={{position:"relative"}}>
              <div style={{width:"72px",height:"72px",borderRadius:"50%",background:`linear-gradient(135deg,${rCol}40,${rCol}20)`,border:`3px solid ${rCol}55`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <span style={{fontFamily:D.head,fontSize:"24px",fontWeight:800,color:rCol}}>{p.name.split(" ").map(w=>w[0]).join("").slice(0,2)}</span>
              </div>
              <div style={{position:"absolute",bottom:0,right:0,width:"18px",height:"18px",borderRadius:"50%",background:p.fitness==="fit"?D.emerald:p.fitness==="injured"?D.rose:D.amber,border:`2px solid ${D.surf1}`}}/>
            </div>
            <div style={{flex:1}}>
              <div style={{display:"flex",gap:"8px",alignItems:"center",flexWrap:"wrap",marginBottom:"4px"}}>
                <span style={{fontFamily:D.head,fontSize:"22px",fontWeight:800,color:D.textPrimary}}>{p.name}</span>
                {p.cap&&<span style={{padding:"2px 8px",borderRadius:D.pill,background:D.amber+"22",border:`1px solid ${D.amber}33`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.amber}}>{p.cap==="c"?"CAPTAIN":"VICE CAPTAIN"}</span>}
              </div>
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"8px"}}>
                <Badge color={rCol}>{p.role==="BAT"?"Batter":p.role==="BOWL"?"Bowler":p.role==="ALL"?"Allrounder":"WK Batter"}</Badge>
                <Badge color={D.sky}>{schoolInfo} · {p.team}</Badge>
                <Badge color={p.fitness==="fit"?D.emerald:p.fitness==="injured"?D.rose:D.orange}>{p.fitness}</Badge>
                {p.batHand&&<Badge color={D.textMuted}>{p.batHand}HB · {p.bowlArm}{p.bowlArm?"A":""} {p.bowlStyle==="F"?"Fast":p.bowlStyle==="S"?"Spin":"Medium"}</Badge>}
              </div>
              <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,maxWidth:"520px",lineHeight:1.5}}>{p.bio}</div>
            </div>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
              {p.born&&<div style={{textAlign:"center",padding:"8px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`}}>
                <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Born</div>
                <div style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,marginTop:"2px"}}>{p.born}</div>
              </div>}
              {p.height&&<div style={{textAlign:"center",padding:"8px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`}}>
                <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Height</div>
                <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginTop:"2px"}}>{p.height}</div>
              </div>}
              {p.weight&&<div style={{textAlign:"center",padding:"8px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`}}>
                <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Weight</div>
                <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginTop:"2px"}}>{p.weight}</div>
              </div>}
            </div>
          </div>
        </div>

        {/* Tab nav */}
        <div style={{display:"flex",gap:"4px",padding:"10px 16px",borderBottom:`1px solid ${D.border}`,overflowX:"auto"}}>
          {tabs.map(t=>(
            <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
              padding:"5px 14px",borderRadius:D.pill,cursor:"pointer",textTransform:"capitalize",flexShrink:0,
              border:`1px solid ${tab===t?rCol+"55":D.border}`,background:tab===t?rCol+"12":"transparent",
              fontFamily:D.body,fontSize:"11px",fontWeight:tab===t?600:400,color:tab===t?rCol:D.textMuted,
            }}>{t}</button>
          ))}
        </div>

        <div style={{padding:"18px"}}>
          {/* OVERVIEW TAB */}
          {tab==="overview"&&(
            <>
              {/* Season stats row */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(90px,1fr))",gap:"8px",marginBottom:"18px"}}>
                {p.avg>0&&<StatBox label="Batting Avg" value={p.avg} color={p.avg>=40?D.emerald:p.avg>=25?D.sky:D.amber} big/>}
                {p.sr>0&&<StatBox label="Strike Rate" value={p.sr} color={p.sr>=130?D.emerald:p.sr>=100?D.sky:D.amber} big/>}
                {p.wkts>0&&<StatBox label="Wickets" value={p.wkts} color={p.wkts>=15?D.rose:D.violet} big/>}
                {p.econ>0&&<StatBox label="Economy" value={p.econ} color={p.econ<=6.5?D.emerald:p.econ<=8?D.amber:D.rose} big/>}
                {p.careerTotals?.innings&&<StatBox label="Innings" value={p.careerTotals.innings} big/>}
                {p.careerTotals?.runs&&<StatBox label="Career Runs" value={p.careerTotals.runs} color={D.sky} big/>}
                {p.careerTotals?.hs&&<StatBox label="High Score" value={p.careerTotals.hs} color={D.amber} big/>}
                {p.careerTotals?.fifties!==undefined&&<StatBox label="50s / 100s" value={`${p.careerTotals.fifties}/${p.careerTotals.hundreds||0}`} big/>}
                {p.careerTotals?.wktsTotal>0&&<StatBox label="Career Wkts" value={p.careerTotals.wktsTotal} color={D.rose} big/>}
                {p.careerTotals?.stumpings!=null&&<StatBox label="Stumpings" value={p.careerTotals.stumpings} color={D.amber} big/>}
                {p.careerTotals?.catches!=null&&<StatBox label="Catches (WK)" value={p.careerTotals.catches} color={D.teal} big/>}
              </div>

              {/* Radar + injury side by side */}
              <div style={{display:"grid",gridTemplateColumns:skills?"1fr 1fr":"1fr",gap:"14px",marginBottom:"14px"}}>
                {skills&&(
                  <Card sx={{padding:"14px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>SKILLS RADAR</div>
                    <div style={{display:"flex",justifyContent:"center"}}>
                      <RadarChart data={{
                        Batting:  Math.round(Object.values(skills.batting).reduce((a,b)=>a+b,0)/Object.values(skills.batting).length),
                        Bowling:  Math.round(Object.values(skills.bowling).reduce((a,b)=>a+b,0)/Object.values(skills.bowling).length),
                        Fielding: Math.round(Object.values(skills.fielding).reduce((a,b)=>a+b,0)/Object.values(skills.fielding).length),
                        Fitness:  Math.round(Object.values(skills.fitness).reduce((a,b)=>a+b,0)/Object.values(skills.fitness).length),
                      }} color={rCol} size={160}/>
                    </div>
                  </Card>
                )}
                <Card sx={{padding:"14px"}}>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>PERSONAL</div>
                  {[
                    ["Hometown",    p.hometown||"—"],
                    ["School House",p.houseAtSchool||"—"],
                    ["Batting Pos", p.battingPos?`No. ${p.battingPos}`:"—"],
                    ["Bat / Bowl",  `${p.batHand}HB · ${p.bowlArm||"—"}A ${p.bowlStyle==="F"?"Fast":p.bowlStyle==="S"?"Spin":"Medium"}`],
                  ].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${D.border}`}}>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,fontWeight:500}}>{v}</span>
                    </div>
                  ))}
                  {inj&&(
                    <div style={{marginTop:"10px",padding:"8px 10px",background:D.rose+"0a",borderRadius:D.sm,border:`1px solid ${D.rose}22`}}>
                      <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.rose,letterSpacing:"0.08em",marginBottom:"3px"}}>CURRENT INJURY</div>
                      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{inj.type} · {inj.phase}</div>
                      <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,marginTop:"2px"}}>RTW: {inj.rtw}</div>
                    </div>
                  )}
                </Card>
              </div>

              {/* Recent form */}
              {p.form&&(
                <Card sx={{padding:"14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em"}}>FORM (LAST 8)</div>
                    <Spark data={p.form} color={rCol} height={32}/>
                  </div>
                  <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                    {p.form.map((v,i)=>(
                      <div key={i} style={{width:"36px",height:"36px",borderRadius:D.sm,background:v===0?D.rose+"20":v>=5?D.amber+"20":D.emerald+"20",border:`1px solid ${v===0?D.rose+"33":v>=5?D.amber+"33":D.emerald+"33"}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <span style={{fontFamily:D.mono,fontSize:"12px",fontWeight:700,color:v===0?D.rose:v>=5?D.amber:D.emerald}}>{v===0?"W":v}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}

          {/* CAREER TAB */}
          {tab==="career"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
              <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
                <Card sx={{padding:"14px"}}>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"12px"}}>BATTING CAREER</div>
                  {[
                    ["Innings",      p.careerTotals?.innings||"—"],
                    ["Total Runs",   p.careerTotals?.runs||"—"],
                    ["High Score",   p.careerTotals?.hs||"—"],
                    ["Fifties",      p.careerTotals?.fifties||0],
                    ["Hundreds",     p.careerTotals?.hundreds||0],
                    ["Batting Avg",  p.avg],
                    ["Strike Rate",  p.sr],
                  ].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${D.border}`}}>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                      <span style={{fontFamily:D.mono,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>{v}</span>
                    </div>
                  ))}
                </Card>
                {p.wkts>0&&(
                  <Card sx={{padding:"14px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"12px"}}>BOWLING CAREER</div>
                    {[
                      ["Career Wickets", p.careerTotals?.wktsTotal||"—"],
                      ["Season Wickets", p.wkts],
                      ["Economy Rate",   p.econ],
                      ["Balls Bowled",   p.careerTotals?.balls||"—"],
                      ["Maidens",        p.careerTotals?.maidens||0],
                      ["Bowl Arm",       `${p.bowlArm||"—"}-arm`],
                      ["Bowl Style",     p.bowlStyle==="F"?"Fast":p.bowlStyle==="S"?"Spin":"Medium"],
                    ].map(([l,v])=>(
                      <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${D.border}`}}>
                        <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                        <span style={{fontFamily:D.mono,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>{v}</span>
                      </div>
                    ))}
                  </Card>
                )}
              </div>
              {/* Batting position visual */}
              {p.battingPos&&(
                <Card sx={{padding:"14px"}}>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>BATTING POSITION</div>
                  <div style={{display:"flex",gap:"6px"}}>
                    {Array.from({length:11},(_,i)=>i+1).map(n=>(
                      <div key={n} style={{width:"32px",height:"32px",borderRadius:D.sm,display:"flex",alignItems:"center",justifyContent:"center",
                        background:n===p.battingPos?rCol:"transparent",
                        border:`1px solid ${n===p.battingPos?rCol:D.border}`,}}>
                        <span style={{fontFamily:D.mono,fontSize:"11px",fontWeight:n===p.battingPos?700:400,color:n===p.battingPos?"#fff":D.textMuted}}>{n}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* FORM TAB */}
          {tab==="form"&&(
            <div>
              {p.seasonForm?.length>0?(
                <Card>
                  <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>
                    2025 Season — Match by Match
                  </div>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead>
                      <tr style={{background:D.surf2}}>
                        {["Opponent","Date","Runs","Wkts","Result"].map(h=>(
                          <th key={h} style={{padding:"8px 12px",fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:h==="Opponent"||h==="Date"?"left":"center"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {p.seasonForm.map((s,i)=>(
                        <tr key={i} style={{borderTop:`1px solid ${D.border}`}}>
                          <td style={{padding:"9px 12px",fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{s.opp}</td>
                          <td style={{padding:"9px 12px",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{s.date}</td>
                          <td style={{padding:"9px 12px",textAlign:"center"}}>
                            {s.runs!=null?<span style={{fontFamily:D.mono,fontSize:"13px",fontWeight:700,color:s.runs>=50?D.amber:s.runs>=25?D.sky:s.runs===0?D.rose:D.textPrimary}}>{s.runs}</span>:<span style={{color:D.textMuted,fontSize:"11px"}}>—</span>}
                          </td>
                          <td style={{padding:"9px 12px",textAlign:"center"}}>
                            {s.wkts>0?<span style={{fontFamily:D.mono,fontSize:"13px",fontWeight:700,color:D.violet}}>{s.wkts}w</span>:<span style={{color:D.textMuted,fontSize:"11px"}}>—</span>}
                          </td>
                          <td style={{padding:"9px 12px",textAlign:"center"}}>
                            {s.result&&<Badge color={s.result==="W"?D.emerald:s.result==="L"?D.rose:s.result==="NR"?D.amber:D.textMuted}>{s.result}</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              ):(
                <div style={{textAlign:"center",padding:"40px",color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>No season form data yet.</div>
              )}
            </div>
          )}

          {/* VS OPPONENTS TAB */}
          {tab==="vs opponents"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {p.vsOpponents?Object.entries(p.vsOpponents).map(([opp,rec])=>{
                const wr = rec.avg||(rec.runs&&rec.P?Math.round(rec.runs/rec.P):null);
                return (
                  <Card key={opp} sx={{padding:"14px 16px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"14px",flexWrap:"wrap"}}>
                      <div style={{flex:1}}>
                        <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,marginBottom:"2px"}}>{opp}</div>
                        <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{rec.P} match{rec.P!==1?"es":""}</div>
                      </div>
                      {rec.runs!=null&&<StatBox label="Runs" value={rec.runs} color={D.sky}/>}
                      {rec.avg!=null&&<StatBox label="Avg" value={rec.avg} color={rec.avg>=40?D.emerald:D.amber}/>}
                      {rec.wkts!=null&&<StatBox label="Wkts" value={rec.wkts} color={D.rose}/>}
                    </div>
                  </Card>
                );
              }):(
                <div style={{textAlign:"center",padding:"40px",color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>No opponent data recorded yet.</div>
              )}
            </div>
          )}

          {/* DEVELOPMENT TAB */}
          {tab==="development"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
              {skills?(
                <>
                  {Object.entries(skills).map(([cat,vals])=>(
                    <Card key={cat} sx={{padding:"14px"}}>
                      <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"12px",textTransform:"uppercase"}}>{cat}</div>
                      <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                        {Object.entries(vals).map(([skill,score])=>{
                          const sc = score>=80?D.emerald:score>=65?D.sky:score>=50?D.amber:D.rose;
                          const label = score>=80?"Elite":score>=65?"Good":score>=50?"Avg":"Dev";
                          return (
                            <div key={skill} style={{display:"flex",alignItems:"center",gap:"10px"}}>
                              <div style={{width:"90px",fontFamily:D.body,fontSize:"11px",color:D.textSecondary,textTransform:"capitalize"}}>{skill}</div>
                              <div style={{flex:1,height:"6px",borderRadius:"3px",background:D.surf3,overflow:"hidden"}}>
                                <div style={{height:"100%",width:`${score}%`,borderRadius:"3px",background:sc,transition:"width .6s"}}/>
                              </div>
                              <div style={{fontFamily:D.mono,fontSize:"11px",fontWeight:600,color:sc,width:"28px",textAlign:"right"}}>{score}</div>
                              <Badge color={sc} style={{minWidth:"36px",textAlign:"center"}}>{label}</Badge>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  ))}
                </>
              ):(
                <Card sx={{padding:"32px",textAlign:"center"}}>
                  <div style={{fontSize:"28px",marginBottom:"10px"}}>🎯</div>
                  <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted}}>No skills assessment on file. Coach can add via Skills module.</div>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Coach Profile Panel ──
  const CoachProfile = ({c}) => {
    const tabs = ["overview","career","sessions"];
    const coachPlayers = PLAYERS.filter(p=>p.team===c.team && p.school==="HIL");
    return (
      <div style={{flex:1,overflowY:"auto"}}>
        <div style={{background:`linear-gradient(135deg,${D.emerald}18,${D.surf1} 60%)`,padding:"24px",borderBottom:`1px solid ${D.border}`}}>
          <div style={{display:"flex",gap:"18px",alignItems:"flex-start",flexWrap:"wrap"}}>
            <div style={{width:"72px",height:"72px",borderRadius:"50%",background:`linear-gradient(135deg,${D.emerald}40,${D.emerald}20)`,border:`3px solid ${D.emerald}55`,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontFamily:D.head,fontSize:"24px",fontWeight:800,color:D.emerald}}>{c.name.split(" ").filter(w=>w!=="Mr"&&w!=="Ms"&&w!=="Mrs").map(w=>w[0]).join("").slice(0,2)}</span>
            </div>
            <div style={{flex:1}}>
              <div style={{fontFamily:D.head,fontSize:"22px",fontWeight:800,color:D.textPrimary,marginBottom:"4px"}}>{c.name}</div>
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"8px"}}>
                <Badge color={D.emerald}>{c.role}</Badge>
                <Badge color={D.sky}>{c.team}</Badge>
                <Badge color={D.teal}>{c.qual}</Badge>
              </div>
              <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,maxWidth:"520px",lineHeight:1.5}}>{c.bio}</div>
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:"4px",padding:"10px 16px",borderBottom:`1px solid ${D.border}`}}>
          {tabs.map(t=>(
            <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
              padding:"5px 14px",borderRadius:D.pill,cursor:"pointer",textTransform:"capitalize",
              border:`1px solid ${tab===t?D.emerald+"55":D.border}`,background:tab===t?D.emerald+"12":"transparent",
              fontFamily:D.body,fontSize:"11px",fontWeight:tab===t?600:400,color:tab===t?D.emerald:D.textMuted,
            }}>{t}</button>
          ))}
        </div>
        <div style={{padding:"18px"}}>
          {tab==="overview"&&(
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",gap:"8px",marginBottom:"16px"}}>
                <StatBox label="Matches" value={c.stats.matchesCoached} big/>
                <StatBox label="Wins" value={c.stats.wins} color={D.emerald} big/>
                <StatBox label="Losses" value={c.stats.losses} color={D.rose} big/>
                <StatBox label="Win Rate" value={`${c.stats.winRate}%`} color={c.stats.winRate>=65?D.emerald:D.amber} big/>
                <StatBox label="Promoted" value={c.stats.playersPromoted} color={D.sky} sub="To Province" big/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
                <Card sx={{padding:"14px"}}>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>QUALIFICATIONS</div>
                  {c.qualifications.map(q=>(
                    <div key={q} style={{display:"flex",alignItems:"flex-start",gap:"7px",padding:"5px 0",borderBottom:`1px solid ${D.border}`}}>
                      <div style={{width:"5px",height:"5px",borderRadius:"50%",background:D.emerald,marginTop:"5px",flexShrink:0}}/>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{q}</span>
                    </div>
                  ))}
                </Card>
                <Card sx={{padding:"14px"}}>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>CONTACT</div>
                  {[["📞 Phone",c.phone],["✉️ Email",c.email],["🏠 Hometown",c.hometown||"—"],["🎂 Born",c.born||"—"]].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${D.border}`}}>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary}}>{v}</span>
                    </div>
                  ))}
                </Card>
              </div>
              <Card sx={{padding:"14px",marginTop:"12px"}}>
                <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>SQUAD — {c.team}</div>
                <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                  {coachPlayers.map(p=>(
                    <button key={p.id} onClick={()=>{handleSelect(p.id,"players");}} className="pressBtn" style={{
                      display:"flex",alignItems:"center",gap:"7px",padding:"6px 10px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`,cursor:"pointer",
                    }}>
                      <Avatar name={p.name} size={24} color={fitnessColor(p.fitness)}/>
                      <div style={{textAlign:"left"}}>
                        <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:500,color:D.textPrimary}}>{p.name}</div>
                        <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{p.role}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </Card>
            </>
          )}
          {tab==="career"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {c.coachingCareer?.map((r,i)=>(
                <div key={i} style={{display:"flex",gap:"14px",alignItems:"center",padding:"12px 14px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`}}>
                  <div style={{width:"8px",height:"8px",borderRadius:"50%",background:i===0?D.emerald:D.textMuted,flexShrink:0}}/>
                  <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted,width:"90px"}}>{r.year}</div>
                  <div>
                    <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>{r.role} · {r.team}</div>
                    <Badge color={r.level==="Provincial"?D.violet:r.level==="School"?D.sky:D.amber}>{r.level}</Badge>
                  </div>
                </div>
              ))}
              <Card sx={{padding:"14px",marginTop:"4px"}}>
                <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"8px"}}>SPECIALISATION</div>
                <p style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,lineHeight:1.6}}>{c.specialisation}</p>
                <div style={{marginTop:"10px",fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>📅 Availability: {c.availability}</div>
                {c.notes&&<div style={{marginTop:"8px",padding:"8px 10px",background:D.amber+"0a",borderRadius:D.sm,fontFamily:D.body,fontSize:"11px",color:D.textSecondary,fontStyle:"italic"}}>{c.notes}</div>}
              </Card>
            </div>
          )}
          {tab==="sessions"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {TRAINING_SESSIONS.filter(s=>s.coach===c.id).map(s=>(
                <Card key={s.id} sx={{padding:"13px 15px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
                    <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary}}>{s.title}</div>
                    <Badge color={s.type==="fitness"?D.amber:s.type==="batting"?D.sky:D.emerald}>{s.type}</Badge>
                  </div>
                  <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>{s.date} · {s.time} · {s.duration}min · {s.venue}</div>
                  <div style={{marginTop:"6px",display:"flex",gap:"4px",flexWrap:"wrap"}}>{s.drills.map(d=><Pill key={d} color={D.indigo}>{d}</Pill>)}</div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const hiltonPlayers = PLAYERS.filter(p=>p.school==="HIL");
  const westvillePlayers = PLAYERS.filter(p=>p.school==="WES");

  return (
    <div className="os-page">
      <SectionHeader title="Profiles" sub="Players · Coaches · Staff — in-depth profiles with stats and analysis" color={D.violet}/>

      <div style={{display:"grid",gridTemplateColumns:"var(--g-side-l,220px 1fr)",gap:"16px",alignItems:"start"}}>
        {/* Left: entity list */}
        <div>
          {/* Category tabs */}
          <div style={{display:"flex",gap:"4px",marginBottom:"12px"}}>
            {["players","coaches","staff"].map(c2=>(
              <button key={c2} onClick={()=>{setCat(c2);setSelId(null);}} className="pressBtn" style={{
                flex:1,padding:"6px 0",borderRadius:D.md,cursor:"pointer",textTransform:"capitalize",
                border:`1px solid ${cat===c2?D.violet+"55":D.border}`,background:cat===c2?D.violet+"14":"transparent",
                fontFamily:D.body,fontSize:"10px",fontWeight:cat===c2?600:400,color:cat===c2?D.violet:D.textMuted,
              }}>{c2}</button>
            ))}
          </div>

          {cat==="players"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
              {/* Hilton */}
              <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",padding:"4px 8px",marginTop:"4px"}}>HILTON COLLEGE</div>
              {["U19A","U15A","U13A"].map(team=>(
                <div key={team}>
                  <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,padding:"3px 8px"}}>{team}</div>
                  {hiltonPlayers.filter(p=>p.team===team).map(p=>(
                    <button key={p.id} onClick={()=>handleSelect(p.id,"players")} className="pressBtn" style={{
                      width:"100%",padding:"7px 10px",borderRadius:D.md,cursor:"pointer",textAlign:"left",marginBottom:"2px",
                      border:`1px solid ${selId===p.id?D.violet+"55":D.border}`,background:selId===p.id?D.violet+"10":D.surf1,
                    }}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                        <div style={{position:"relative",flexShrink:0}}>
                          <Avatar name={p.name} size={28} color={fitnessColor(p.fitness)}/>
                          <div style={{position:"absolute",bottom:-1,right:-1,width:"8px",height:"8px",borderRadius:"50%",background:fitnessColor(p.fitness),border:`1.5px solid ${D.surf1}`}}/>
                        </div>
                        <div style={{minWidth:0}}>
                          <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:selId===p.id?600:400,color:D.textPrimary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                          <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{p.role}{p.cap?` · ${p.cap.toUpperCase()}`:""}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
              {/* Westville */}
              <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",padding:"4px 8px",marginTop:"8px"}}>WESTVILLE BOYS' HIGH</div>
              {["U19A","U15A"].map(team=>(
                <div key={team}>
                  <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,padding:"3px 8px"}}>{team}</div>
                  {westvillePlayers.filter(p=>p.team===team).map(p=>(
                    <button key={p.id} onClick={()=>handleSelect(p.id,"players")} className="pressBtn" style={{
                      width:"100%",padding:"7px 10px",borderRadius:D.md,cursor:"pointer",textAlign:"left",marginBottom:"2px",
                      border:`1px solid ${selId===p.id?D.amber+"55":D.border}`,background:selId===p.id?D.amber+"10":D.surf1,
                    }}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                        <Avatar name={p.name} size={28} color={D.amber}/>
                        <div style={{minWidth:0}}>
                          <div style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                          <div style={{fontFamily:D.mono,fontSize:"9px",color:D.amber}}>WES · {p.role}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {cat==="coaches"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
              {COACHES.map(c2=>(
                <button key={c2.id} onClick={()=>handleSelect(c2.id,"coaches")} className="pressBtn" style={{
                  width:"100%",padding:"9px 10px",borderRadius:D.md,cursor:"pointer",textAlign:"left",marginBottom:"2px",
                  border:`1px solid ${selId===c2.id?D.emerald+"55":D.border}`,background:selId===c2.id?D.emerald+"10":D.surf1,
                }}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <Avatar name={c2.name} size={30} color={D.emerald}/>
                    <div>
                      <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:500,color:D.textPrimary}}>{c2.name.split(" ").slice(1).join(" ")}</div>
                      <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{c2.role} · {c2.team}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {cat==="staff"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
              {["scorer","medical","driver","groundskeeper"].map(sRole=>(
                <div key={sRole}>
                  <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:ROLES[sRole]?.color||D.textMuted,letterSpacing:"0.08em",padding:"4px 8px",marginTop:"4px",textTransform:"uppercase"}}>{sRole}s</div>
                  {STAFF.filter(s=>s.role===sRole).map(s=>(
                    <button key={s.id} onClick={()=>handleSelect(s.id,"staff")} className="pressBtn" style={{
                      width:"100%",padding:"7px 10px",borderRadius:D.md,cursor:"pointer",textAlign:"left",marginBottom:"2px",
                      border:`1px solid ${selId===s.id?(ROLES[s.role]?.color||D.cyan)+"55":D.border}`,background:selId===s.id?(ROLES[s.role]?.color||D.cyan)+"10":D.surf1,
                    }}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                        <Avatar name={s.name} size={28} color={ROLES[s.role]?.color||D.cyan}/>
                        <div style={{fontFamily:D.body,fontSize:"11px",color:D.textPrimary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name.split(" ").slice(1).join(" ")}</div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: profile detail */}
        <div style={{minHeight:"500px",display:"flex",flexDirection:"column"}}>
          {!selId&&(
            <Card sx={{padding:"60px",textAlign:"center",flex:1}}>
              <div style={{fontSize:"48px",marginBottom:"16px"}}>👤</div>
              <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary,marginBottom:"8px"}}>Select a Profile</div>
              <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted}}>Choose a player, coach or staff member from the list to view their full profile.</div>
            </Card>
          )}
          {selId&&selPlayer&&<PlayerProfile p={selPlayer}/>}
          {selId&&selCoach&&!selPlayer&&<CoachProfile c={selCoach}/>}
          {selId&&selStaff&&!selPlayer&&!selCoach&&(
            <Card sx={{padding:"24px"}}>
              <div style={{fontFamily:D.head,fontSize:"18px",fontWeight:800,color:D.textPrimary,marginBottom:"6px"}}>{selStaff.name}</div>
              <Badge color={ROLES[selStaff.role]?.color||D.cyan}>{selStaff.role}</Badge>
              <div style={{marginTop:"12px",fontFamily:D.body,fontSize:"13px",color:D.textSecondary,lineHeight:1.6}}>{selStaff.experience}</div>
              <div style={{marginTop:"10px",fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>📞 {selStaff.phone} · ✉️ {selStaff.email}</div>
              <div style={{marginTop:"8px",fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>Full staff profile available in the Staff module →</div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  LEAGUE MANAGEMENT VIEW
// ══════════════════════════════════════════════════════
function LeagueView({ role }) {
  const [selComp, setSelComp] = useState("comp1");
  const [tab,     setTab]     = useState("table");
  const [editRow, setEditRow] = useState(null);  // team row being edited
  const [addFixture, setAddFixture] = useState(false);
  const comp = COMPETITIONS.find(c=>c.id===selComp);
  const canEdit = role==="superadmin"||role==="schooladmin";

  // Editable table row state
  const [tableEdit, setTableEdit] = useState({}); // { teamName: {W,L,NR} }

  const compMatches = MATCHES.filter(m=>m.competition===selComp);

  // Top performers from squad
  const topBat = PLAYERS.filter(p=>p.school==="HIL"&&p.avg>0).sort((a,b)=>b.avg-a.avg).slice(0,5);
  const topBowl = PLAYERS.filter(p=>p.school==="HIL"&&p.wkts>0).sort((a,b)=>b.wkts-a.wkts).slice(0,5);

  const NRR = (nrr) => (
    <span style={{fontFamily:D.mono,fontSize:"12px",fontWeight:600,color:nrr>0?D.emerald:nrr<0?D.rose:D.textMuted}}>
      {nrr>=0?"+":""}{nrr.toFixed(2)}
    </span>
  );

  return (
    <div className="os-page">
      <SectionHeader title="League Management" sub="Standings · Fixtures · Results · Top Performers" color={D.amber}
        actions={canEdit&&<Btn size="sm" onClick={()=>setAddFixture(true)}>+ Add Fixture</Btn>}/>

      {/* Competition selector */}
      <div style={{display:"flex",gap:"8px",marginBottom:"20px",flexWrap:"wrap"}}>
        {COMPETITIONS.map(c=>(
          <button key={c.id} onClick={()=>{setSelComp(c.id);setTab("table");}} className="pressBtn" style={{
            padding:"8px 16px",borderRadius:D.md,cursor:"pointer",textAlign:"left",
            border:`1px solid ${selComp===c.id?D.amber+"55":D.border}`,
            background:selComp===c.id?D.amber+"10":D.surf1,
          }}>
            <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:selComp===c.id?700:400,color:selComp===c.id?D.textPrimary:D.textSecondary}}>{c.name}</div>
            <div style={{display:"flex",gap:"4px",marginTop:"3px",flexWrap:"wrap"}}>
              <Badge color={D.sky}>{c.format}</Badge>
              <Badge color={D.teal}>{c.ageGroup}</Badge>
              <Badge color={c.active?D.emerald:D.textMuted}>{c.active?"Active":"Ended"}</Badge>
            </div>
          </button>
        ))}
      </div>

      {comp&&(
        <>
          {/* Tab bar */}
          <div style={{display:"flex",gap:"6px",marginBottom:"16px"}}>
            {["table","fixtures","results","performers"].filter(t=>{
              if(t==="table") return comp.table||comp.type==="league"||comp.type==="tournament";
              if(t==="performers") return true;
              return true;
            }).map(t=>(
              <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
                padding:"6px 16px",borderRadius:D.pill,cursor:"pointer",textTransform:"capitalize",
                border:`1px solid ${tab===t?D.amber+"55":D.border}`,background:tab===t?D.amber+"14":"transparent",
                fontFamily:D.body,fontSize:"11px",fontWeight:tab===t?600:400,color:tab===t?D.amber:D.textMuted,
              }}>{t}</button>
            ))}
          </div>

          {/* ── TABLE ── */}
          {tab==="table"&&(comp.table?(
            <Card>
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{comp.name}</div>
                  <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{comp.teams} teams · {comp.format} · {comp.region}</div>
                </div>
                {canEdit&&<Btn size="sm" variant="ghost" onClick={()=>setEditRow("all")}>Edit Standings</Btn>}
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{background:D.surf2}}>
                      {["#","Team","P","W","L","NR","Pts","NRR","Form","Action"].map(h=>(
                        <th key={h} style={{padding:"10px 12px",fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:h==="Team"?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comp.table.map((t,i)=>{
                      const isHilton = t.team.includes("Hilton");
                      const isEdit = editRow==="all";
                      const ed = tableEdit[t.team]||{};
                      return (
                        <tr key={t.team} style={{borderTop:`1px solid ${D.border}`,background:isHilton?D.indigo+"08":"transparent"}}>
                          <td style={{padding:"11px 12px",textAlign:"center"}}>
                            <div style={{width:"24px",height:"24px",borderRadius:"50%",background:i===0?D.amber+"22":D.surf2,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto"}}>
                              <span style={{fontFamily:D.mono,fontSize:"11px",fontWeight:700,color:i===0?D.amber:D.textMuted}}>{i+1}</span>
                            </div>
                          </td>
                          <td style={{padding:"11px 12px"}}>
                            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                              <div style={{width:"8px",height:"8px",borderRadius:"50%",background:isHilton?"#003366":"#888",flexShrink:0}}/>
                              <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:isHilton?700:400,color:isHilton?D.textPrimary:D.textSecondary}}>{t.team}</span>
                              {isHilton&&<Badge color={D.indigo}>Us</Badge>}
                            </div>
                          </td>
                          {["P","W","L","NR"].map(k=>(
                            <td key={k} style={{padding:"11px 12px",textAlign:"center"}}>
                              {isEdit&&k!=="P"?(
                                <input type="number" defaultValue={t[k]} onChange={e=>setTableEdit(prev=>({...prev,[t.team]:{...prev[t.team],[k]:Number(e.target.value)}}))}
                                  style={{width:"40px",background:D.surf2,border:`1px solid ${D.borderMed}`,borderRadius:D.sm,padding:"3px 6px",fontFamily:D.mono,fontSize:"11px",color:D.textPrimary,textAlign:"center"}}/>
                              ):(
                                <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textSecondary}}>{t[k]}</span>
                              )}
                            </td>
                          ))}
                          <td style={{padding:"11px 12px",textAlign:"center"}}>
                            <span style={{fontFamily:D.mono,fontSize:"14px",fontWeight:700,color:isHilton?D.emerald:D.textPrimary}}>{isEdit&&ed.pts!=null?ed.pts:t.pts}</span>
                          </td>
                          <td style={{padding:"11px 12px",textAlign:"center"}}>{NRR(t.nrr)}</td>
                          <td style={{padding:"11px 12px",textAlign:"center"}}>
                            <div style={{display:"flex",gap:"2px",justifyContent:"center"}}>
                              {Array.from({length:t.P},(_,j)=>j<t.W?"W":j<t.W+t.L?"L":"N").map((r,j)=>(
                                <div key={j} style={{width:"12px",height:"12px",borderRadius:"2px",background:r==="W"?D.emerald+"44":r==="L"?D.rose+"44":D.amber+"44",display:"flex",alignItems:"center",justifyContent:"center"}}>
                                  <span style={{fontFamily:D.mono,fontSize:"7px",fontWeight:700,color:r==="W"?D.emerald:r==="L"?D.rose:D.amber}}>{r}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                          <td style={{padding:"11px 12px",textAlign:"center"}}>
                            {canEdit&&isEdit&&(
                              <button onClick={()=>setEditRow(null)} style={{background:D.emerald+"18",border:`1px solid ${D.emerald}33`,borderRadius:D.sm,padding:"3px 8px",cursor:"pointer",color:D.emerald,fontFamily:D.body,fontSize:"10px"}}>Save</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {editRow==="all"&&<div style={{padding:"12px 16px",borderTop:`1px solid ${D.border}`}}><Btn onClick={()=>setEditRow(null)}>✓ Save Changes</Btn></div>}
            </Card>
          ):(
            <div style={{textAlign:"center",padding:"40px",color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>No standings table for this competition format.</div>
          ))}

          {/* ── CUP BRACKET ── */}
          {tab==="table"&&comp.bracket&&(
            <div style={{marginTop:"16px"}}>
              <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginBottom:"14px"}}>Cup Bracket</div>
              <div style={{display:"flex",gap:"16px",overflowX:"auto",paddingBottom:"8px"}}>
                {comp.bracket.map(round=>(
                  <div key={round.round} style={{minWidth:"220px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.amber,letterSpacing:"0.06em",marginBottom:"10px"}}>{round.round}</div>
                    <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                      {round.fixtures.map((f,i)=>(
                        <div key={i} style={{padding:"10px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${f.status==="complete"?D.emerald+"22":D.border}`}}>
                          <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:500,color:f.status==="complete"?D.textPrimary:D.textSecondary,marginBottom:"4px"}}>{f.home}</div>
                          <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginBottom:"4px"}}>VS</div>
                          <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:500,color:f.status==="complete"?D.textPrimary:D.textSecondary,marginBottom:"6px"}}>{f.away}</div>
                          {f.result&&<div style={{fontFamily:D.body,fontSize:"10px",color:f.result.includes("Hilton")?D.emerald:D.amber,fontStyle:"italic"}}>{f.result}</div>}
                          {!f.result&&f.status!=="pending"&&<Badge color={D.sky}>Upcoming</Badge>}
                          {f.status==="pending"&&<Badge color={D.textMuted}>TBD</Badge>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── FIXTURES ── */}
          {tab==="fixtures"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {compMatches.filter(m=>m.status==="upcoming").length===0&&(
                <Card sx={{padding:"32px",textAlign:"center"}}><div style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>No upcoming fixtures in this competition.</div></Card>
              )}
              {compMatches.filter(m=>m.status==="upcoming").map(m=>{
                const w = WEATHER[m.id];
                return (
                  <Card key={m.id} sx={{padding:"14px 16px"}}>
                    <div style={{display:"flex",gap:"16px",alignItems:"center",flexWrap:"wrap"}}>
                      <div style={{flex:1}}>
                        <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,marginBottom:"3px"}}>{m.homeTeam} <span style={{color:D.textMuted,fontSize:"12px",fontWeight:400}}>vs</span> {m.awayTeam}</div>
                        <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>📅 {m.date} · 📍 {m.venue}</div>
                      </div>
                      {w&&<WeatherChip w={w} compact/>}
                      {m.transport?.bus&&<Pill color={D.lime}>🚌 {m.transport.depart}</Pill>}
                      {canEdit&&<Btn size="sm" variant="ghost">Enter Result</Btn>}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* ── RESULTS ── */}
          {tab==="results"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {compMatches.filter(m=>m.status==="complete").length===0&&(
                <Card sx={{padding:"32px",textAlign:"center"}}><div style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>No results yet.</div></Card>
              )}
              {compMatches.filter(m=>m.status==="complete").map(m=>(
                <Card key={m.id} sx={{padding:"14px 16px",border:`1px solid ${m.result?.includes("Hilton")?D.emerald+"22":D.rose+"11"}`}}>
                  <div style={{display:"flex",gap:"12px",alignItems:"center",flexWrap:"wrap"}}>
                    <Badge color={m.result?.includes("Hilton")?D.emerald:D.rose}>{m.result?.includes("Hilton")?"W":"L"}</Badge>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{m.homeTeam} vs {m.awayTeam}</div>
                      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{m.date} · {m.venue}</div>
                    </div>
                    {m.scorecard&&(
                      <div style={{display:"flex",gap:"8px",fontFamily:D.mono,fontSize:"12px"}}>
                        <span style={{color:D.emerald}}>{m.scorecard.home.score} ({m.scorecard.home.overs})</span>
                        <span style={{color:D.textMuted}}>vs</span>
                        {m.scorecard.away&&<span style={{color:D.textSecondary}}>{m.scorecard.away.score} ({m.scorecard.away.overs})</span>}
                      </div>
                    )}
                    <div style={{fontFamily:D.body,fontSize:"11px",color:m.result?.includes("Hilton")?D.emerald:D.amber,fontStyle:"italic"}}>{m.result}</div>
                    {canEdit&&<Btn size="sm" variant="ghost">Edit</Btn>}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* ── TOP PERFORMERS ── */}
          {tab==="performers"&&(
            <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"14px"}}>
              <Card>
                <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>🏏 Top Batters — {comp.ageGroup}</div>
                {topBat.map((p,i)=>(
                  <div key={p.id} style={{padding:"10px 14px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"10px"}}>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted,width:"16px"}}>{i+1}</span>
                    <Avatar name={p.name} size={28} color={D.sky}/>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{p.name}</div>
                      <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{p.team}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:D.mono,fontSize:"14px",fontWeight:700,color:p.avg>=40?D.emerald:D.sky}}>{p.avg}</div>
                      <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>avg</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:D.mono,fontSize:"13px",color:D.amber}}>{p.sr}</div>
                      <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>SR</div>
                    </div>
                  </div>
                ))}
              </Card>
              <Card>
                <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>⚡ Top Bowlers — {comp.ageGroup}</div>
                {topBowl.map((p,i)=>(
                  <div key={p.id} style={{padding:"10px 14px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"10px"}}>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted,width:"16px"}}>{i+1}</span>
                    <Avatar name={p.name} size={28} color={D.violet}/>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{p.name}</div>
                      <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{p.team}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:D.mono,fontSize:"14px",fontWeight:700,color:D.rose}}>{p.wkts}</div>
                      <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>wkts</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:D.mono,fontSize:"13px",color:p.econ<=6.5?D.emerald:D.amber}}>{p.econ}</div>
                      <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>econ</div>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          )}
        </>
      )}

      {addFixture&&(
        <Modal title="Add Fixture" onClose={()=>setAddFixture(false)}>
          <Input label="Home Team" value="" onChange={()=>{}} placeholder="e.g. Hilton U19A"/>
          <Input label="Away Team" value="" onChange={()=>{}} placeholder="e.g. Michaelhouse U19A"/>
          <Input label="Venue" value="" onChange={()=>{}} placeholder="Ground name"/>
          <Input label="Date" value="" onChange={()=>{}} type="date"/>
          <Select label="Competition" value={selComp} onChange={()=>{}} options={COMPETITIONS.map(c=>({value:c.id,label:c.name}))}/>
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"8px"}}>
            <Btn variant="ghost" onClick={()=>setAddFixture(false)}>Cancel</Btn>
            <Btn onClick={()=>setAddFixture(false)}>Create Fixture</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  SETTINGS VIEW — full user CRUD + RBAC + upgrades
// ══════════════════════════════════════════════════════
function SettingsView({ role, users: usersFromApp, setUsers: setUsersFromApp }) {
  const [tab,       setTab]       = useState("users");
  const [usersLocal,setUsersLocal]= useState(USERS_INITIAL);
  // Use lifted state if provided, else local fallback
  const users    = usersFromApp    || usersLocal;
  const setUsers = setUsersFromApp || setUsersLocal;
  const [editUser,  setEditUser]  = useState(null);
  const [addUser,   setAddUser]   = useState(false);
  const [delConf,   setDelConf]   = useState(null);
  const [newUser,   setNewUser]   = useState({name:"",email:"",role:"player",player:"",staffId:"",coachId:"",status:"active"});
  const canEdit = role==="superadmin";

  const saveUser = () => {
    if (editUser) {
      setUsers(prev=>prev.map(u=>u.id===editUser.id?{...u,...editUser}:u));
    } else {
      const id = `u${Date.now()}`;
      setUsers(prev=>[...prev,{...newUser,id,lastLogin:"Never"}]);
    }
    setEditUser(null);
    setAddUser(false);
    setNewUser({name:"",email:"",role:"player",player:"",staffId:"",coachId:"",status:"active"});
  };

  const deleteUser = (id) => { setUsers(prev=>prev.filter(u=>u.id!==id)); setDelConf(null); };
  const toggleStatus = (id) => setUsers(prev=>prev.map(u=>u.id===id?{...u,status:u.status==="active"?"suspended":"active"}:u));

  const PERMS = {
    superadmin:    ["Full system access","User management","RBAC control","All 16 modules","System configuration","Audit logs"],
    schooladmin:   ["Dashboard, Competitions, Squad, Analytics","Logistics, Fields, Staff, Calendar","Notifications, Settings (limited)","No RBAC control"],
    coach:         ["Dashboard, Matches, Squad, Profiles","Skills, Training, Injuries, Analytics","Logistics, Fields, Calendar","No user management"],
    player:        ["Dashboard, Own profile","Matches (view), Fixtures","Skills (own), Training (own)","Injuries (own), Notifications"],
    parent:        ["Dashboard, Matches, Fixtures","Transport info, Notifications","Child's profile (read-only)"],
    spectator:     ["Dashboard, Live scores","Competitions (public view)","Analytics (read-only)", "Calendar"],
    scorer:        ["Dashboard, Match Centre","Scoring tools only","Calendar, Notifications"],
    medical:       ["Injuries (full CRUD)","Squad health view","Training fitness data","Profiles, Notifications"],
    driver:        ["Logistics (transport)","Matches (fixture times)","Calendar, Notifications"],
    groundskeeper: ["Fields (full CRUD)","Matches (schedule view)","Calendar, Notifications"],
  };

  const UPGRADES = [
    { id:"up1", category:"AI & Analysis",  priority:"high",  title:"AI Post-Match Report",      desc:"Auto-generate match reports using AI commentary, scorecard data and weather. Send to parents and coaches instantly.", effort:"Medium" },
    { id:"up2", category:"AI & Analysis",  priority:"high",  title:"Shot Pattern Wagon Wheel",  desc:"Import wagon-wheel data from SCRBRD scorer to show each player's scoring zones and shot tendencies.", effort:"High" },
    { id:"up3", category:"Integrations",   priority:"high",  title:"Live Score Sync (SCRBRD)",  desc:"Wire MatchCentreView to live scrbrd_v3 scorer data. Real-time wickets, overs, partnerships.", effort:"Medium" },
    { id:"up4", category:"Comms",          priority:"high",  title:"Parent Broadcast Alerts",   desc:"Push notifications to parents when their child scores a fifty, takes a wicket, or is injured.", effort:"Medium" },
    { id:"up5", category:"AI & Analysis",  priority:"medium",title:"Opposition Scouting Report",desc:"AI-generated scouting notes on upcoming opponents based on their H2H record and known squad.", effort:"Medium" },
    { id:"up6", category:"Fitness",        priority:"medium",title:"Fitness Test Logging",       desc:"Record beep tests, speed gates, vertical jump, grip strength. Track trends across the season.", effort:"Low" },
    { id:"up7", category:"Media",          priority:"medium",title:"Video Clip Tagging",         desc:"Upload short batting/bowling clips per session. Tag to player profile and link to skill gaps.", effort:"High" },
    { id:"up8", category:"Integrations",   priority:"medium",title:"CricHQ / PlayCricket Sync", desc:"Import match scorecards automatically from CricHQ or PlayCricket via API. Reduce manual entry.", effort:"High" },
    { id:"up9", category:"Comms",          priority:"medium",title:"In-App Parent Messaging",    desc:"Secure one-to-one messaging between coach and parent. Replaces WhatsApp groups.", effort:"High" },
    { id:"up10",category:"Admin",          priority:"low",   title:"PDF Scorecard Export",       desc:"One-click PDF export of any match scorecard, formatted with school branding.", effort:"Low" },
    { id:"up11",category:"Admin",          priority:"low",   title:"Season History Archive",     desc:"Year-on-year squad stats, win rates and trophies. Accessible as historical records.", effort:"Medium" },
    { id:"up12",category:"Fitness",        priority:"low",   title:"Medical Clearance Workflow", desc:"Digital RTW forms. Physio signs off, coach notified, system auto-updates injury status.", effort:"Medium" },
    { id:"up13",category:"Admin",          priority:"low",   title:"Payment & Subscription Mgmt",desc:"Track school subscription, per-student fees for transport/kit. Admin dashboard.", effort:"High" },
    { id:"up14",category:"AI & Analysis",  priority:"low",   title:"Training Recommendation Engine",desc:"AI suggests next training focus per player based on recent form, skill gaps and workload.", effort:"High" },
  ];

  const priCol = p => p==="high"?D.rose:p==="medium"?D.amber:D.sky;
  const catCol  = c => c==="AI & Analysis"?D.violet:c==="Integrations"?D.teal:c==="Comms"?D.indigo:c==="Fitness"?D.emerald:D.orange;

  return (
    <div className="os-page">
      <SectionHeader title="Settings & Access Control" sub="Users · RBAC · School config · Platform upgrades" color={D.violet}/>

      <div style={{display:"flex",gap:"6px",marginBottom:"20px",flexWrap:"wrap"}}>
        {["users","roles","school","upgrades"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} className="pressBtn" style={{
            padding:"6px 18px",borderRadius:D.pill,cursor:"pointer",textTransform:"capitalize",
            border:`1px solid ${tab===t?D.violet+"55":D.border}`,background:tab===t?D.violet+"14":"transparent",
            fontFamily:D.body,fontSize:"11px",fontWeight:tab===t?700:400,color:tab===t?D.violet:D.textMuted,
          }}>{t==="upgrades"?"🚀 Upgrades":t}</button>
        ))}
      </div>

      {/* ── USERS CRUD ── */}
      {tab==="users"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px",flexWrap:"wrap",gap:"8px"}}>
            <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>{users.length} users · {users.filter(u=>u.status==="active").length} active</div>
            {canEdit&&<Btn size="sm" onClick={()=>{setAddUser(true);setEditUser(null);}}>+ Add User</Btn>}
          </div>
          <Card>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{background:D.surf2}}>
                    {["User","Role","Email","Linked To","Last Login","Status","Actions"].map(h=>(
                      <th key={h} style={{padding:"10px 12px",fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:h==="User"?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u,i)=>{
                    const rc2 = ROLES[u.role];
                    const linked = u.player
                      ? PLAYERS.find(p=>p.id===u.player)?.name
                      : u.staffId
                        ? STAFF.find(s=>s.id===u.staffId)?.name
                        : u.coachId
                          ? COACHES.find(c=>c.id===u.coachId)?.name
                          : "—";
                    return (
                      <tr key={u.id} style={{borderTop:`1px solid ${D.border}`,background:i%2===0?"transparent":D.surf2+"22",opacity:u.status==="suspended"?0.55:1}}>
                        <td style={{padding:"10px 12px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                            <Avatar name={u.name} size={30} color={rc2?.color||D.textMuted}/>
                            <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{u.name}</span>
                          </div>
                        </td>
                        <td style={{padding:"10px 12px",textAlign:"center"}}><Badge color={rc2?.color||D.textMuted}>{rc2?.icon} {rc2?.label}</Badge></td>
                        <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{u.email}</td>
                        <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{linked||"—"}</td>
                        <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{u.lastLogin}</td>
                        <td style={{padding:"10px 12px",textAlign:"center"}}><Badge color={u.status==="active"?D.emerald:D.rose}>{u.status}</Badge></td>
                        <td style={{padding:"10px 12px",textAlign:"center"}}>
                          {canEdit&&(
                            <div style={{display:"flex",gap:"4px",justifyContent:"center"}}>
                              <button onClick={()=>setEditUser({...u})} style={{background:"none",border:`1px solid ${D.border}`,borderRadius:D.sm,padding:"3px 9px",cursor:"pointer",fontFamily:D.body,fontSize:"10px",color:D.textSecondary}}>Edit</button>
                              <button onClick={()=>toggleStatus(u.id)} style={{background:"none",border:`1px solid ${u.status==="active"?D.amber+"44":D.emerald+"44"}`,borderRadius:D.sm,padding:"3px 9px",cursor:"pointer",fontFamily:D.body,fontSize:"10px",color:u.status==="active"?D.amber:D.emerald}}>{u.status==="active"?"Suspend":"Restore"}</button>
                              <button onClick={()=>setDelConf(u)} style={{background:"none",border:`1px solid ${D.rose}33`,borderRadius:D.sm,padding:"3px 9px",cursor:"pointer",fontFamily:D.body,fontSize:"10px",color:D.rose}}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── ROLES ── */}
      {tab==="roles"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:"12px"}}>
          {Object.entries(ROLES).map(([r,rc2])=>(
            <Card key={r} sx={{padding:"16px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"12px"}}>
                <div style={{width:"38px",height:"38px",borderRadius:D.md,background:rc2.color+"18",border:`1px solid ${rc2.color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"20px"}}>{rc2.icon}</div>
                <div>
                  <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:rc2.color}}>{rc2.label}</div>
                  <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{rc2.nav.length} modules · {users.filter(u=>u.role===r).length} user{users.filter(u=>u.role===r).length!==1?"s":""}</div>
                </div>
              </div>
              {PERMS[r]?.map(p=>(
                <div key={p} style={{display:"flex",alignItems:"flex-start",gap:"7px",padding:"4px 0"}}>
                  <div style={{width:"5px",height:"5px",borderRadius:"50%",background:rc2.color,flexShrink:0,marginTop:"4px"}}/>
                  <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.4}}>{p}</span>
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}

      {/* ── SCHOOL CONFIG ── */}
      {tab==="school"&&(
        <Card sx={{padding:"20px",maxWidth:"520px"}}>
          <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginBottom:"16px"}}>School Configuration</div>
          {[["School Name",SCHOOL.name],["Abbreviation",SCHOOL.abbr],["Address",SCHOOL.address],["Province",SCHOOL.province],["Region",SCHOOL.region],["Altitude",SCHOOL.altitude],["Climate",SCHOOL.climate],["Founded",SCHOOL.founded],["Active Teams","3 (U13A, U15A, U19A)"],["Hilton Players",PLAYERS.filter(p=>p.school==="HIL").length],["Westville Players",PLAYERS.filter(p=>p.school==="WES").length],["Staff Members",STAFF.length],["Coaches",COACHES.length],["Registered Users",users.length],["SCRBRD Version","2.2.0"],].map(([l,v])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${D.border}`,gap:"12px"}}>
              <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,flexShrink:0}}>{l}</span>
              <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textPrimary,fontWeight:500,textAlign:"right"}}>{v}</span>
            </div>
          ))}
          {canEdit&&<div style={{marginTop:"14px"}}><Btn size="sm">Edit Config</Btn></div>}
        </Card>
      )}

      {/* ── UPGRADES ── */}
      {tab==="upgrades"&&(
        <div>
          <div style={{padding:"14px 16px",background:`linear-gradient(135deg,${D.violet}10,${D.surf2})`,borderRadius:D.lg,border:`1px solid ${D.violet}22`,marginBottom:"18px"}}>
            <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.violet,marginBottom:"4px"}}>🚀 SCRBRD Platform Roadmap</div>
            <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,lineHeight:1.5}}>{UPGRADES.length} suggested upgrades across {[...new Set(UPGRADES.map(u=>u.category))].length} categories. Prioritised by impact.</div>
          </div>
          {["high","medium","low"].map(pri=>(
            <div key={pri} style={{marginBottom:"20px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
                <Badge color={priCol(pri)}>{pri==="high"?"🔴 High Priority":pri==="medium"?"🟡 Medium Priority":"🔵 Low Priority"}</Badge>
                <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{UPGRADES.filter(u=>u.priority===pri).length} items</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:"10px"}}>
                {UPGRADES.filter(u=>u.priority===pri).map(up=>(
                  <Card key={up.id} sx={{padding:"14px",border:`1px solid ${priCol(pri)}18`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
                      <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary,flex:1,paddingRight:"8px"}}>{up.title}</div>
                      <Badge color={catCol(up.category)}>{up.category}</Badge>
                    </div>
                    <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.5,marginBottom:"10px"}}>{up.desc}</div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>Effort: <span style={{color:up.effort==="Low"?D.emerald:up.effort==="Medium"?D.amber:D.rose}}>{up.effort}</span></div>
                      <button style={{background:"none",border:`1px solid ${D.border}`,borderRadius:D.pill,padding:"3px 12px",cursor:"pointer",fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>Vote ↑</button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ADD / EDIT MODAL ── */}
      {(addUser||editUser)&&(
        <Modal title={editUser?"Edit User":"Add New User"} onClose={()=>{setAddUser(false);setEditUser(null);}}>
          <Input label="Full Name" value={editUser?editUser.name:newUser.name} onChange={e=>editUser?setEditUser(p=>({...p,name:e.target.value})):setNewUser(p=>({...p,name:e.target.value}))} placeholder="First Last"/>
          <Input label="Email" value={editUser?editUser.email:newUser.email} onChange={e=>editUser?setEditUser(p=>({...p,email:e.target.value})):setNewUser(p=>({...p,email:e.target.value}))} type="email" placeholder="user@hilton.co.za"/>
          <Select label="Role" value={editUser?editUser.role:newUser.role} onChange={v=>editUser?setEditUser(p=>({...p,role:v})):setNewUser(p=>({...p,role:v}))} options={Object.entries(ROLES).map(([v,r])=>({value:v,label:`${r.icon} ${r.label}`}))}/>
          <Select label="Linked Player (optional)" value={editUser?editUser.player||"":newUser.player} onChange={v=>editUser?setEditUser(p=>({...p,player:v||null})):setNewUser(p=>({...p,player:v}))} options={[{value:"",label:"None"},...PLAYERS.map(p=>({value:p.id,label:`${p.name} (${p.team} · ${p.school})`}))]}/>
          <Select label="Linked Coach (optional)" value={editUser?editUser.coachId||"":newUser.coachId} onChange={v=>editUser?setEditUser(p=>({...p,coachId:v||null})):setNewUser(p=>({...p,coachId:v}))} options={[{value:"",label:"None"},...COACHES.map(c=>({value:c.id,label:`${c.name} (${c.team})`}))]}/>
          <Select label="Linked Staff (optional)" value={editUser?editUser.staffId||"":newUser.staffId} onChange={v=>editUser?setEditUser(p=>({...p,staffId:v||null})):setNewUser(p=>({...p,staffId:v}))} options={[{value:"",label:"None"},...STAFF.map(s=>({value:s.id,label:`${s.name} (${s.role})`}))]}/>
          <Select label="Status" value={editUser?editUser.status:newUser.status} onChange={v=>editUser?setEditUser(p=>({...p,status:v})):setNewUser(p=>({...p,status:v}))} options={[{value:"active",label:"Active"},{value:"suspended",label:"Suspended"}]}/>
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"10px"}}>
            <Btn variant="ghost" onClick={()=>{setAddUser(false);setEditUser(null);}}>Cancel</Btn>
            <Btn onClick={saveUser}>{editUser?"Save Changes":"Create User"}</Btn>
          </div>
        </Modal>
      )}

      {/* ── DELETE CONFIRM ── */}
      {delConf&&(
        <Modal title="Delete User" onClose={()=>setDelConf(null)}>
          <p style={{fontFamily:D.body,fontSize:"13px",color:D.textSecondary,lineHeight:1.6}}>
            Are you sure you want to delete <strong style={{color:D.textPrimary}}>{delConf.name}</strong>?
            This action cannot be undone.
          </p>
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"12px"}}>
            <Btn variant="ghost" onClick={()=>setDelConf(null)}>Cancel</Btn>
            <Btn style={{background:D.rose+"18",border:`1px solid ${D.rose}33`,color:D.rose}} onClick={()=>deleteUser(delConf.id)}>Delete User</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════════════
//  MANAGEMENT VIEW
// ══════════════════════════════════════════════════════
function ManagementView({ role, users, setUsers }) {
  const [activeTab, setActiveTab] = useState("users");
  const [editUser,  setEditUser]  = useState(null);   // user obj being edited
  const [addOpen,   setAddOpen]   = useState(false);
  const [delConf,   setDelConf]   = useState(null);   // id to confirm delete
  const [filterRole,setFilterRole]= useState("all");
  const [filterStatus,setFilterStatus]=useState("all");
  const [searchQ,   setSearchQ]   = useState("");
  const [newUser,   setNewUser]   = useState({name:"",email:"",role:"player",status:"active"});

  const isSuperAdmin  = role==="superadmin";
  const isAdmin       = ["superadmin","schooladmin","sportsmaster"].includes(role);
  const isGroundskeeper = role==="groundskeeper";
  const canManageUsers= isSuperAdmin;

  // Filtered users
  const filteredUsers = (users||USERS_INITIAL).filter(u=>{
    if(filterRole!=="all"&&u.role!==filterRole) return false;
    if(filterStatus!=="all"&&u.status!==filterStatus) return false;
    if(searchQ&&!u.name.toLowerCase().includes(searchQ.toLowerCase())&&!u.email.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  const saveUser = () => {
    if(editUser?.id) {
      setUsers(prev=>prev.map(u=>u.id===editUser.id?{...u,...editUser}:u));
    } else {
      const id=`u${Date.now()}`;
      setUsers(prev=>[...prev,{...newUser,id,lastLogin:"Never"}]);
    }
    setEditUser(null); setAddOpen(false);
    setNewUser({name:"",email:"",role:"player",status:"active"});
  };

  const deleteUser  = id => { setUsers(prev=>prev.filter(u=>u.id!==id)); setDelConf(null); };
  const toggleStatus= id => setUsers(prev=>prev.map(u=>u.id===id?{...u,status:u.status==="active"?"suspended":"active"}:u));
  const promoteRole = (id, newRole) => {
    if(newRole==="superadmin"&&!isSuperAdmin) return; // only SA can assign SA
    setUsers(prev=>prev.map(u=>u.id===id?{...u,role:newRole}:u));
  };

  const TABS_MAP = {
    superadmin:    [{id:"users",icon:"👥",label:"User Management",color:D.violet},{id:"squad",icon:"🏏",label:"Squad Admin",color:D.sky},{id:"fixtures",icon:"📅",label:"Fixtures",color:D.amber},{id:"broadcast",icon:"📡",label:"Broadcast",color:D.rose},{id:"audit",icon:"🔍",label:"Audit Log",color:D.textMuted}],
    schooladmin:   [{id:"users",icon:"👥",label:"Users",color:D.indigo},{id:"squad",icon:"🏏",label:"Squad Admin",color:D.sky},{id:"fixtures",icon:"📅",label:"Fixtures",color:D.amber},{id:"broadcast",icon:"📡",label:"Broadcast",color:D.rose}],
    sportsmaster:  [{id:"squad",icon:"🏏",label:"Team Management",color:D.sky},{id:"fixtures",icon:"📅",label:"Fixture Admin",color:D.amber},{id:"broadcast",icon:"📡",label:"Announcements",color:D.rose}],
    coach:         [{id:"squad",icon:"🏏",label:"Squad Tools",color:D.emerald}],
    groundskeeper: [{id:"grounds",icon:"🌿",label:"Ground Tasks",color:D.teal}],
  };
  const tabs = TABS_MAP[role]||TABS_MAP.coach;

  const AUDIT_LOG=[
    {time:"Today 09:14",user:"G. Sutherland",action:"Updated fixture — Hilton vs Michaelhouse (Sat)",type:"fixture"},
    {time:"Today 08:32",user:"C. Hendricks", action:"Added training session — Batting Nets 15:30",type:"training"},
    {time:"Yesterday",  user:"Super Admin",  action:"User u14 role changed: viewer → assistant",type:"user"},
    {time:"2d ago",     user:"B. Wessels",   action:"Match scorecard submitted — Hilton U19A vs DHS",type:"match"},
    {time:"3d ago",     user:"Dr Khumalo",   action:"Medical clearance updated — T. Pretorius",type:"medical"},
    {time:"4d ago",     user:"Super Admin",  action:"New user created — L. Dube (Coaching Asst)",type:"user"},
  ];

  const GROUND_TASKS=[
    {id:"g1",task:"Prepare Main Oval — U19A vs Michaelhouse",due:"Fri 13 Mar",priority:"high",  status:"in_progress",assignee:"E. Mzimba"},
    {id:"g2",task:"Roll and mark Practice Net 1",            due:"Thu 12 Mar",priority:"medium",status:"pending",    assignee:"S. Hadebe"},
    {id:"g3",task:"Outfield mowing — full circuit",          due:"Wed 11 Mar",priority:"low",   status:"done",       assignee:"E. Mzimba"},
    {id:"g4",task:"Pitch report — match day assessment",     due:"Fri 13 Mar",priority:"high",  status:"pending",    assignee:"E. Mzimba"},
    {id:"g5",task:"Irrigation check — all three pitches",    due:"Today",     priority:"medium",status:"done",       assignee:"S. Hadebe"},
  ];

  const priCol=p=>p==="high"?D.rose:p==="medium"?D.amber:D.textMuted;
  const statusPill=s=>({pending:{c:D.amber,l:"Pending"},in_progress:{c:D.sky,l:"In Progress"},done:{c:D.emerald,l:"Done"}}[s]||{c:D.amber,l:"Pending"});

  // ── User Edit / Add Modal ──
  const UserModal = () => {
    const u = editUser || newUser;
    const setU = editUser ? setEditUser : setNewUser;
    const availableRoles = Object.entries(ROLES).filter(([r])=>
      r!=="superadmin"||isSuperAdmin  // Only SA can set SA
    );
    return (
      <div style={{position:"fixed",inset:0,zIndex:600,background:"rgba(0,0,0,0.7)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
        <div style={{width:"100%",maxWidth:"480px",borderRadius:D.xl,border:`1px solid ${D.borderMed}`,background:D.surf1,overflow:"hidden",boxShadow:"0 24px 80px rgba(0,0,0,0.5)"}}>
          {/* Header */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 20px",borderBottom:`1px solid ${D.border}`,background:`${D.violet}08`}}>
            <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:800,color:D.textPrimary}}>{editUser?"✏️ Edit User":"➕ Add New User"}</div>
            <button onClick={()=>{setEditUser(null);setAddOpen(false);}} className="pressBtn" style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"20px"}}>×</button>
          </div>
          {/* Body */}
          <div style={{padding:"20px",display:"flex",flexDirection:"column",gap:"14px"}}>
            {/* Role chip preview */}
            {u.role&&<div style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 14px",borderRadius:D.md,background:`${ROLES[u.role]?.color||D.indigo}12`,border:`1px solid ${ROLES[u.role]?.color||D.indigo}33`}}>
              <span style={{fontSize:"16px"}}>{ROLES[u.role]?.icon}</span>
              <span style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:ROLES[u.role]?.color||D.indigo}}>{ROLES[u.role]?.label}</span>
              {u.role==="superadmin"&&<span style={{marginLeft:"auto",fontFamily:D.head,fontSize:"8px",color:D.rose}}>⚠ Highest privilege</span>}
            </div>}

            {[
              {label:"Full Name *",     key:"name",  type:"text",  placeholder:"e.g. Craig Hendricks"},
              {label:"Email Address *", key:"email", type:"email", placeholder:"email@school.co.za"},
            ].map(f=>(
              <div key={f.key}>
                <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginBottom:"5px"}}>{f.label}</div>
                <input value={u[f.key]||""} type={f.type} onChange={e=>setU(prev=>({...prev,[f.key]:e.target.value}))}
                  placeholder={f.placeholder}
                  style={{width:"100%",padding:"10px 14px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.body,fontSize:"13px",color:D.textPrimary,outline:"none",boxSizing:"border-box"}}/>
              </div>
            ))}

            {/* Role selector */}
            <div>
              <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginBottom:"8px"}}>Role {!isSuperAdmin&&"(Super Admin required to assign Super Admin)"}</div>
              <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"6px",maxHeight:"200px",overflowY:"auto",paddingRight:"2px"}}>
                {availableRoles.map(([r,rc])=>(
                  <button key={r} onClick={()=>setU(prev=>({...prev,role:r}))} className="pressBtn" style={{
                    display:"flex",alignItems:"center",gap:"7px",padding:"8px 10px",borderRadius:D.md,cursor:"pointer",
                    border:`1px solid ${u.role===r?rc.color+"55":D.border}`,
                    background:u.role===r?`${rc.color}18`:"transparent",textAlign:"left",
                  }}>
                    <span style={{fontSize:"14px"}}>{rc.icon}</span>
                    <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:u.role===r?rc.color:D.textMuted}}>{rc.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Status */}
            <div>
              <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginBottom:"8px"}}>Account Status</div>
              <div style={{display:"flex",gap:"8px"}}>
                {["active","suspended"].map(s=>(
                  <button key={s} onClick={()=>setU(prev=>({...prev,status:s}))} className="pressBtn" style={{
                    flex:1,padding:"8px",borderRadius:D.md,cursor:"pointer",
                    border:`1px solid ${u.status===s?(s==="active"?D.emerald:D.rose)+"66":D.border}`,
                    background:u.status===s?`${s==="active"?D.emerald:D.rose}14`:"transparent",
                    fontFamily:D.head,fontSize:"10px",fontWeight:700,textTransform:"capitalize",
                    color:u.status===s?(s==="active"?D.emerald:D.rose):D.textMuted,
                  }}>{s==="active"?"● Active":"○ Suspended"}</button>
                ))}
              </div>
            </div>
          </div>
          {/* Footer */}
          <div style={{display:"flex",gap:"10px",padding:"14px 20px",borderTop:`1px solid ${D.border}`,background:D.surf2}}>
            <button onClick={()=>{setEditUser(null);setAddOpen(false);}} className="pressBtn" style={{flex:1,padding:"10px",borderRadius:D.md,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted}}>Cancel</button>
            <button onClick={saveUser} disabled={!(u.name&&u.email)} className="pressBtn" style={{flex:2,padding:"10px",borderRadius:D.md,cursor:"pointer",background:u.name&&u.email?D.violet:"rgba(255,255,255,0.08)",border:"none",fontFamily:D.head,fontSize:"11px",fontWeight:700,color:u.name&&u.email?"#fff":"rgba(255,255,255,0.3)"}}>
              {editUser?"Save Changes":"Create User"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Delete Confirm ──
  const DeleteModal = () => {
    const u = (users||USERS_INITIAL).find(x=>x.id===delConf);
    if(!u) return null;
    return (
      <div style={{position:"fixed",inset:0,zIndex:700,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
        <div style={{width:"100%",maxWidth:"360px",borderRadius:D.xl,border:`1px solid ${D.rose}44`,background:D.surf1,padding:"24px",textAlign:"center"}}>
          <div style={{fontSize:"36px",marginBottom:"12px"}}>⚠️</div>
          <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:800,color:D.textPrimary,marginBottom:"6px"}}>Delete User?</div>
          <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,marginBottom:"20px"}}>This will permanently remove <strong style={{color:D.textSecondary}}>{u.name}</strong>. This cannot be undone.</div>
          <div style={{display:"flex",gap:"10px"}}>
            <button onClick={()=>setDelConf(null)} className="pressBtn" style={{flex:1,padding:"10px",borderRadius:D.md,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted}}>Cancel</button>
            <button onClick={()=>deleteUser(delConf)} className="pressBtn" style={{flex:1,padding:"10px",borderRadius:D.md,cursor:"pointer",background:D.rose,border:"none",fontFamily:D.head,fontSize:"11px",fontWeight:700,color:"#fff"}}>Delete</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"20px"}}>
      {(editUser||addOpen)&&canManageUsers&&<UserModal/>}
      {delConf&&canManageUsers&&<DeleteModal/>}

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:"16px",flexWrap:"wrap"}}>
        <div>
          <div style={{fontFamily:D.head,fontSize:"22px",fontWeight:800,color:D.textPrimary}}>Management Tools</div>
          <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,marginTop:"2px"}}>Role-specific admin controls · {ROLES[role]?.label}</div>
        </div>
        <div style={{marginLeft:"auto",padding:"5px 14px",borderRadius:D.pill,background:`${ROLES[role]?.color||D.indigo}18`,border:`1px solid ${ROLES[role]?.color||D.indigo}44`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:ROLES[role]?.color||D.indigo}}>
          {ROLES[role]?.icon} {ROLES[role]?.label}
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} className="pressBtn" style={{display:"flex",alignItems:"center",gap:"6px",padding:"7px 14px",borderRadius:D.pill,cursor:"pointer",border:`1px solid ${activeTab===t.id?t.color+"55":D.border}`,background:activeTab===t.id?`${t.color}18`:"transparent",fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.06em",color:activeTab===t.id?t.color:D.textMuted,transition:"all .18s"}}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── USER MANAGEMENT ── */}
      {activeTab==="users"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
          {/* Controls */}
          <div style={{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center"}}>
            {/* Search */}
            <div style={{position:"relative",flex:1,minWidth:"180px"}}>
              <span style={{position:"absolute",left:"10px",top:"50%",transform:"translateY(-50%)",fontSize:"12px",color:D.textMuted}}>🔍</span>
              <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search users…"
                style={{width:"100%",padding:"8px 12px 8px 30px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.body,fontSize:"12px",color:D.textPrimary,outline:"none",boxSizing:"border-box"}}/>
            </div>
            {/* Role filter */}
            <select value={filterRole} onChange={e=>setFilterRole(e.target.value)}
              style={{padding:"7px 12px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.body,fontSize:"11px",color:D.textSecondary,outline:"none",cursor:"pointer"}}>
              <option value="all">All Roles</option>
              {Object.entries(ROLES).map(([r,rc])=><option key={r} value={r}>{rc.icon} {rc.label}</option>)}
            </select>
            {/* Status filter */}
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
              style={{padding:"7px 12px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,fontFamily:D.body,fontSize:"11px",color:D.textSecondary,outline:"none",cursor:"pointer"}}>
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
            {canManageUsers&&(
              <button onClick={()=>{setAddOpen(true);setEditUser(null);}} className="pressBtn" style={{padding:"7px 16px",borderRadius:D.pill,cursor:"pointer",background:`${D.violet}18`,border:`1px solid ${D.violet}44`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.violet,whiteSpace:"nowrap"}}>+ Add User</button>
            )}
          </div>

          {/* Stats row */}
          <div style={{display:"flex",gap:"10px",flexWrap:"wrap"}}>
            {[
              {label:"Total",value:(users||USERS_INITIAL).length,color:D.violet},
              {label:"Active",value:(users||USERS_INITIAL).filter(u=>u.status==="active").length,color:D.emerald},
              {label:"Suspended",value:(users||USERS_INITIAL).filter(u=>u.status==="suspended").length,color:D.rose},
              {label:"Showing",value:filteredUsers.length,color:D.sky},
            ].map(s=>(
              <div key={s.label} style={{padding:"10px 16px",borderRadius:D.md,background:D.surf1,border:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"8px"}}>
                <span style={{fontFamily:D.mono,fontSize:"20px",fontWeight:700,color:s.color}}>{s.value}</span>
                <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* User table */}
          <div style={{borderRadius:D.lg,border:`1px solid ${D.border}`,background:D.surf1,overflow:"hidden"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:"700px"}}>
                <thead>
                  <tr style={{background:D.surf2}}>
                    {["User","Role","Email","Status","Last Login","Actions"].map(h=>(
                      <th key={h} style={{padding:"10px 14px",textAlign:"left",fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:D.textMuted,whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length===0&&(
                    <tr><td colSpan={6} style={{padding:"24px",textAlign:"center",fontFamily:D.body,fontSize:"13px",color:D.textMuted}}>No users match the current filter.</td></tr>
                  )}
                  {filteredUsers.map((u,i)=>{
                    const rc2=ROLES[u.role]||{};
                    return(
                      <tr key={u.id} style={{borderTop:`1px solid ${D.border}`,background:i%2===0?"transparent":D.surf2+"22",opacity:u.status==="suspended"?0.55:1,transition:"opacity .2s"}}>
                        {/* User */}
                        <td style={{padding:"10px 14px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                            <div style={{width:"30px",height:"30px",borderRadius:"50%",background:`${rc2.color||D.indigo}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",flexShrink:0}}>{rc2.icon||"👤"}</div>
                            <div>
                              <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary,whiteSpace:"nowrap"}}>{u.name}</div>
                              <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>ID: {u.id}</div>
                            </div>
                          </div>
                        </td>
                        {/* Role */}
                        <td style={{padding:"10px 14px"}}>
                          {canManageUsers ? (
                            <select value={u.role} onChange={e=>promoteRole(u.id,e.target.value)}
                              style={{padding:"4px 8px",borderRadius:D.md,background:`${rc2.color||D.indigo}18`,border:`1px solid ${rc2.color||D.indigo}44`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:rc2.color||D.indigo,cursor:"pointer",outline:"none"}}>
                              {Object.entries(ROLES).filter(([r])=>r!=="superadmin"||isSuperAdmin).map(([r,rc])=>(
                                <option key={r} value={r}>{rc.icon} {rc.label}</option>
                              ))}
                            </select>
                          ) : (
                            <span style={{padding:"3px 9px",borderRadius:D.pill,background:`${rc2.color||D.indigo}18`,border:`1px solid ${rc2.color||D.indigo}33`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:rc2.color||D.indigo}}>
                              {rc2.icon} {rc2.label}
                            </span>
                          )}
                        </td>
                        {/* Email */}
                        <td style={{padding:"10px 14px",fontFamily:D.mono,fontSize:"11px",color:D.textMuted,maxWidth:"180px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</td>
                        {/* Status */}
                        <td style={{padding:"10px 14px"}}>
                          {canManageUsers ? (
                            <button onClick={()=>toggleStatus(u.id)} className="pressBtn" style={{padding:"3px 9px",borderRadius:D.pill,cursor:"pointer",background:u.status==="active"?`${D.emerald}18`:`${D.rose}18`,border:`1px solid ${u.status==="active"?D.emerald:D.rose}44`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:u.status==="active"?D.emerald:D.rose}}>
                              {u.status==="active"?"● Active":"○ Suspended"}
                            </button>
                          ) : (
                            <span style={{padding:"3px 9px",borderRadius:D.pill,background:u.status==="active"?`${D.emerald}18`:`${D.rose}18`,border:`1px solid ${u.status==="active"?D.emerald:D.rose}44`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:u.status==="active"?D.emerald:D.rose}}>
                              {u.status==="active"?"● Active":"○ Suspended"}
                            </span>
                          )}
                        </td>
                        {/* Last login */}
                        <td style={{padding:"10px 14px",fontFamily:D.mono,fontSize:"10px",color:D.textMuted,whiteSpace:"nowrap"}}>{u.lastLogin}</td>
                        {/* Actions */}
                        <td style={{padding:"10px 14px"}}>
                          <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                            {canManageUsers&&(
                              <>
                                <button onClick={()=>{setEditUser({...u});setAddOpen(false);}} className="pressBtn" style={{padding:"4px 10px",borderRadius:D.md,cursor:"pointer",background:D.surf3,border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textSecondary}}>✏️ Edit</button>
                                <button onClick={()=>toggleStatus(u.id)} className="pressBtn" style={{padding:"4px 10px",borderRadius:D.md,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:u.status==="active"?D.amber:D.emerald}}>
                                  {u.status==="active"?"⏸ Suspend":"▶ Restore"}
                                </button>
                                {u.role!=="superadmin"&&<button onClick={()=>setDelConf(u.id)} className="pressBtn" style={{padding:"4px 10px",borderRadius:D.md,cursor:"pointer",background:"transparent",border:`1px solid ${D.rose}44`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.rose}}>🗑</button>}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {!canManageUsers&&<div style={{padding:"12px 16px",borderRadius:D.md,background:`${D.amber}0a`,border:`1px solid ${D.amber}22`,fontFamily:D.body,fontSize:"12px",color:D.amber}}>⚠️ Only Super Admin can create, edit or delete users. Role changes require Super Admin privileges.</div>}
        </div>
      )}

      {/* ── SQUAD ADMIN ── */}
      {activeTab==="squad"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          {["U19A","U15A","U13A"].map(team=>{
            const players=PLAYERS.filter(p=>p.school==="HIL"&&p.team===team);
            return(
              <div key={team} style={{borderRadius:D.lg,border:`1px solid ${D.border}`,background:D.surf1,overflow:"hidden"}}>
                <div style={{padding:"12px 18px",borderBottom:`1px solid ${D.border}`,background:`${D.indigo}08`,display:"flex",alignItems:"center",gap:"10px"}}>
                  <span style={{fontFamily:D.head,fontSize:"12px",fontWeight:800,color:D.textPrimary}}>🏏 Hilton {team}</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>{players.length} players</span>
                  {isAdmin&&<button className="pressBtn" style={{marginLeft:"auto",padding:"4px 12px",borderRadius:D.pill,cursor:"pointer",background:`${D.indigo}18`,border:`1px solid ${D.indigo}44`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.indigo}}>+ Add Player</button>}
                </div>
                {players.map(p=>(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:"12px",padding:"8px 18px",borderBottom:`1px solid ${D.border}44`}}>
                    <div style={{width:"26px",height:"26px",borderRadius:"50%",background:`${D.indigo}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",flexShrink:0}}>{p.role==="WK"?"🧤":"🏏"}</div>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary}}>{p.name}{p.isCaptain&&<span style={{color:D.amber,fontSize:"10px",marginLeft:"6px"}}>© Cap</span>}</div>
                      <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{p.role} · Age {p.age}</div>
                    </div>
                    {p.injuryStatus&&<span style={{padding:"2px 8px",borderRadius:D.pill,background:`${D.rose}18`,border:`1px solid ${D.rose}33`,fontFamily:D.head,fontSize:"8px",fontWeight:700,color:D.rose}}>{p.injuryStatus==="injured"?"🏥 Injured":"🔄 Rehab"}</span>}
                    {isAdmin&&<button className="pressBtn" style={{padding:"3px 10px",borderRadius:D.pill,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"9px",color:D.textMuted}}>Edit</button>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* ── FIXTURES ── */}
      {activeTab==="fixtures"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"8px"}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>📅 Upcoming Fixtures</div>
            {isAdmin&&<button className="pressBtn" style={{padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",background:`${D.indigo}18`,border:`1px solid ${D.indigo}44`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.indigo}}>+ Add Fixture</button>}
          </div>
          {MATCHES.filter(m=>m.status==="upcoming").map(m=>(
            <div key={m.id} style={{borderRadius:D.lg,border:`1px solid ${D.border}`,background:D.surf1,padding:"14px 18px",display:"flex",alignItems:"center",gap:"14px",flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:"160px"}}>
                <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{m.home} vs {m.away}</div>
                <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted,marginTop:"2px"}}>{m.date} · {m.format} · {m.venue}</div>
              </div>
              <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                <span style={{padding:"3px 10px",borderRadius:D.pill,background:`${D.sky}18`,border:`1px solid ${D.sky}33`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.sky}}>{m.competition}</span>
                {isAdmin&&<button className="pressBtn" style={{padding:"3px 10px",borderRadius:D.pill,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"9px",color:D.textMuted}}>✏️ Edit</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── BROADCAST ── */}
      {activeTab==="broadcast"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          <div style={{borderRadius:D.lg,border:`1px solid ${D.rose}33`,background:`${D.rose}06`,padding:"18px 20px"}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.rose,marginBottom:"12px"}}>📡 Send Broadcast Alert</div>
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              <div>
                <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginBottom:"6px"}}>Recipients</div>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                  {["All","Players","Parents","Coaches","Staff"].map(r=>(
                    <button key={r} className="pressBtn" style={{padding:"5px 12px",borderRadius:D.pill,cursor:"pointer",background:r==="All"?`${D.rose}18`:"transparent",border:`1px solid ${r==="All"?D.rose+"55":D.border}`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:r==="All"?D.rose:D.textMuted}}>{r}</button>
                  ))}
                </div>
              </div>
              <div style={{borderRadius:D.md,border:`1px solid ${D.border}`,background:D.surf2,padding:"10px 14px",fontFamily:D.body,fontSize:"12px",color:D.textMuted,minHeight:"60px"}}>Type broadcast message here…</div>
              <button className="pressBtn" style={{alignSelf:"flex-start",padding:"8px 18px",borderRadius:D.pill,cursor:"pointer",background:D.rose,border:"none",fontFamily:D.head,fontSize:"10px",fontWeight:700,color:"#fff"}}>📡 Send Broadcast</button>
            </div>
          </div>
        </div>
      )}

      {/* ── AUDIT LOG ── */}
      {activeTab==="audit"&&isSuperAdmin&&(
        <div style={{borderRadius:D.lg,border:`1px solid ${D.border}`,background:D.surf1,overflow:"hidden"}}>
          <div style={{padding:"12px 18px",borderBottom:`1px solid ${D.border}`}}><div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>🔍 Audit Log</div></div>
          {AUDIT_LOG.map((a,i)=>{
            const tc={fixture:D.amber,training:D.emerald,user:D.violet,match:D.sky,medical:D.rose}[a.type]||D.textMuted;
            return(
              <div key={i} style={{display:"flex",alignItems:"flex-start",gap:"12px",padding:"11px 18px",borderBottom:`1px solid ${D.border}44`}}>
                <div style={{width:"8px",height:"8px",borderRadius:"50%",background:tc,marginTop:"5px",flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontFamily:D.body,fontSize:"13px",color:D.textPrimary}}>{a.action}</div>
                  <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,marginTop:"2px"}}>{a.time} · {a.user}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── GROUND TASKS ── */}
      {activeTab==="grounds"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary}}>🌿 Ground Tasks</div>
            <button className="pressBtn" style={{padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",background:`${D.teal}18`,border:`1px solid ${D.teal}44`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.teal}}>+ New Task</button>
          </div>
          {GROUND_TASKS.map(t=>{
            const sp=statusPill(t.status);
            return(
              <div key={t.id} style={{borderRadius:D.lg,border:`1px solid ${t.priority==="high"?D.rose+"44":D.border}`,background:D.surf1,padding:"12px 18px",display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:"160px"}}>
                  <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary}}>{t.task}</div>
                  <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,marginTop:"2px"}}>Due: {t.due} · {t.assignee}</div>
                </div>
                <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                  <span style={{padding:"3px 9px",borderRadius:D.pill,background:`${priCol(t.priority)}18`,border:`1px solid ${priCol(t.priority)}33`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:priCol(t.priority),textTransform:"capitalize"}}>{t.priority}</span>
                  <span style={{padding:"3px 9px",borderRadius:D.pill,background:`${sp.c}18`,border:`1px solid ${sp.c}33`,fontFamily:D.head,fontSize:"9px",fontWeight:700,color:sp.c}}>{sp.l}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  RULEBOOK VIEW
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  RULEBOOK VIEW
// ══════════════════════════════════════════════════════
function RulebookView({ role }) {
  const [openSection, setOpenSection] = useState("scoring");

  const RULES = [
    {
      id:"scoring", icon:"🏏", title:"Scoring & Run Counting",
      rules:[
        { rule:"A run is scored each time both batsmen complete a run between the wickets after the ball has been struck by the bat or body of the striker." },
        { rule:"Boundaries: The ball reaching or crossing the boundary rope scores 4 runs (ground) or 6 runs (without touching the ground) in addition to any runs completed." },
        { rule:"Extras (Wide, No-Ball, Bye, Leg Bye, Penalty) are credited to the batting team but not to the individual batsman's score, except for No-Ball runs off the bat." },
        { rule:"No-Ball: Bowler overstepping the crease (front foot), ball above waist height (full toss), ball bouncing more than twice, or dangerous bowling — adds 1 run and a free hit in limited-overs cricket." },
        { rule:"Wide: A ball passing the striker outside the reach of the batsman's normal stance adds 1 run and is re-bowled. No wide in Tests — only in limited-overs formats." },
        { rule:"Penalty runs: 5 penalty runs can be awarded for deliberate time-wasting, ball-tampering, or deliberate distraction." },
      ]
    },
    {
      id:"dismissals", icon:"🎳", title:"Methods of Dismissal",
      rules:[
        { rule:"Bowled: Ball delivered by the bowler hits the stumps directly, without any intervening wicket, and dislodges at least one bail." },
        { rule:"Caught: Ball touches the bat or glove and is caught by a fielder before touching the ground. A bowler may also take catches off their own bowling." },
        { rule:"LBW (Leg Before Wicket): Ball hits the batsman's body (not the bat) and would have gone on to hit the stumps. Complex — umpire must consider pitch of delivery, impact, and line." },
        { rule:"Run Out: A fielder puts down the wicket with the ball while a batsman is out of their ground completing a run or attempting a run." },
        { rule:"Stumped: The wicket-keeper puts down the wicket while the batsman is out of their ground and not attempting a run, usually off a missed delivery." },
        { rule:"Hit Wicket: The batsman dislodges the bails with bat or body while playing a shot or beginning the first run." },
        { rule:"Handled the Ball / Obstructing the Field: Batsman intentionally handles ball or obstructs a fielder." },
        { rule:"Hit the Ball Twice: Batsman intentionally hits the ball a second time other than to guard the wicket." },
        { rule:"Timed Out: New batsman takes more than 3 minutes to be ready to face the next ball (rare, but valid)." },
        { rule:"On a Free Hit: Batsman can only be dismissed by Run Out, Stumped, Hit Wicket, Obstructing the Field, or Handled the Ball." },
      ]
    },
    {
      id:"fielding", icon:"🧤", title:"Fielding Restrictions",
      rules:[
        { rule:"T20 / 50-over Powerplay: Only 2 fielders outside the 30-yard circle during the first 6 overs (T20) or 10 overs (50-over)." },
        { rule:"T20 overs 7–20: Maximum 5 fielders outside the 30-yard circle at the time of delivery." },
        { rule:"50-over Middle/Death: Maximum 4 fielders outside the 30-yard circle in overs 11–40, maximum 5 in death overs 41–50." },
        { rule:"Leg-side fielding: Maximum of 2 fielders behind square leg on the on-side at the time of delivery. Violation = Wide or No-Ball in limited overs." },
        { rule:"Fielder substitutions: Substitutes may field, but may not bat or bowl. A fielder absent from the field must bat lower (below #5) if absent more than 15 minutes in Tests or 2 overs in T20." },
      ]
    },
    {
      id:"format", icon:"📋", title:"Format-Specific Rules",
      rules:[
        { rule:"T20: Each team faces 20 overs. Maximum 4 overs per bowler. Wide and No-Ball adds 1 run and an extra delivery." },
        { rule:"T10: Each team faces 10 overs. Maximum 2 overs per bowler. No-ball results in a Free Hit." },
        { rule:"50-over: Each team faces 50 overs. Maximum 10 overs per bowler. DLS method used for rain-affected matches." },
        { rule:"Duckworth-Lewis-Stern (DLS): Used to recalculate target scores in interrupted limited-overs matches, based on resources (overs + wickets) remaining." },
        { rule:"Super Over: Used to break ties in knockout T20 matches. Each team faces 1 over. If still tied, boundary countback is used." },
      ]
    },
    {
      id:"pitch", icon:"🌿", title:"Pitch & Ground Conditions",
      rules:[
        { rule:"The pitch: 22 yards long, 10 feet wide. Prepared in the centre of the square. The condition of the pitch affects pace, bounce, and turn." },
        { rule:"Pitch covering: In Tests, pitches may be left uncovered overnight in some competitions. In limited-overs, pitches are covered to protect from rain." },
        { rule:"Ball maintenance: Fielding side may polish one side of the ball but not apply artificial substances. Ball may be replaced after 80 overs if requested." },
        { rule:"Light stops play: In Tests, players may appeal against the light. In limited-overs, play continues as long as it is safe." },
        { rule:"Dangerous/Unsuitable pitches: Umpires can suspend play if pitch conditions are considered dangerous or unsuitable for play." },
      ]
    },
    {
      id:"scrbrd", icon:"📱", title:"SCRBRD Platform Rules",
      rules:[
        { rule:"Ball-by-ball entry: Each delivery must be entered with type (run/wide/no-ball/bye/lb/wicket), value, and field placement (wagon wheel segment)." },
        { rule:"Shot selection: Shot type should be recorded for each legal delivery faced by the batsman for accurate shot analysis." },
        { rule:"Wicket recording: Dismissal type must be selected from the approved list. 'Caught' requires naming the fielder. 'Run Out' requires end (striker/non-striker)." },
        { rule:"Over completion: After 6 legal deliveries, the over is complete. No-balls and wides are additional deliveries and extend the over." },
        { rule:"Innings completion: Innings ends when 10 wickets have fallen, the over limit is reached, or the captain declares (in non-limited formats)." },
        { rule:"Free Hit: After a Front-Foot No-Ball, the next delivery is a Free Hit. Only run-out, handled ball, hit wicket, obstruction, or stumped dismissals apply." },
      ]
    },
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"20px"}}>
      {/* Header */}
      <div style={{borderRadius:D.lg,border:`1px solid ${D.amber}33`,background:`linear-gradient(135deg,${D.amber}0a,${D.surf1})`,padding:"24px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"16px",flexWrap:"wrap"}}>
          <div style={{fontSize:"40px"}}>📖</div>
          <div>
            <div style={{fontFamily:D.head,fontSize:"24px",fontWeight:800,color:D.textPrimary,lineHeight:1.1}}>SCRBRD Rulebook</div>
            <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,marginTop:"4px"}}>Official cricket rules and platform guidelines for Hilton College CC</div>
          </div>
        </div>
        <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginTop:"16px"}}>
          {RULES.map(s=>(
            <button key={s.id} onClick={()=>setOpenSection(s.id)} className="pressBtn" style={{
              display:"flex",alignItems:"center",gap:"6px",padding:"7px 14px",borderRadius:D.pill,
              cursor:"pointer",border:`1px solid ${openSection===s.id?D.amber+"66":D.border}`,
              background:openSection===s.id?`${D.amber}18`:"transparent",
              fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.05em",
              color:openSection===s.id?D.amber:D.textMuted,transition:"all .18s",
            }}>{s.icon} {s.title}</button>
          ))}
        </div>
      </div>

      {/* Rules content */}
      {RULES.filter(s=>s.id===openSection).map(section=>(
        <div key={section.id} style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:800,color:D.textPrimary}}>
            {section.icon} {section.title}
          </div>
          {section.rules.map((r,i)=>(
            <div key={i} style={{borderRadius:D.md,border:`1px solid ${D.border}`,background:D.surf1,padding:"14px 18px",display:"flex",alignItems:"flex-start",gap:"12px"}}>
              <div style={{width:"22px",height:"22px",borderRadius:"50%",background:`${D.amber}18`,border:`1px solid ${D.amber}33`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:D.mono,fontSize:"10px",fontWeight:700,color:D.amber,flexShrink:0,marginTop:"1px"}}>{i+1}</div>
              <div style={{fontFamily:D.body,fontSize:"13px",color:D.textSecondary,lineHeight:1.6}}>{r.rule}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  PITCH DECK VIEW
// ══════════════════════════════════════════════════════
function PitchDeckView({ role }) {
  const [slide, setSlide] = useState(0);

  const SLIDES = [
    {
      id:"cover", type:"cover",
      title:"SCRBRD",
      sub:"The Modern Cricket Operating System for Schools",
      body:"Intelligent scoring, analytics, squad management and communication — purpose-built for school cricket.",
      accent:D.violet,
    },
    {
      id:"problem", type:"content",
      title:"The Problem",
      icon:"❌",
      points:[
        "Manual scorebooks lose data and take hours to update",
        "Coaches lack real-time player performance insights",
        "Parents and players have no access to match data",
        "Squad management, logistics and medical are siloed",
        "No single platform connects all school cricket stakeholders",
      ],
      accent:D.rose,
    },
    {
      id:"solution", type:"content",
      title:"SCRBRD Solution",
      icon:"✅",
      points:[
        "Live ball-by-ball scoring with AI commentary generation",
        "Wagon wheel shot analysis with player-by-player breakdown",
        "Full squad management with skills matrix and development tracking",
        "Role-based access for players, coaches, parents, admin and medical",
        "Integrated logistics, calendar, injury tracking and notifications",
      ],
      accent:D.emerald,
    },
    {
      id:"product", type:"split",
      title:"Two Core Products",
      icon:"🏏",
      items:[
        {
          name:"SCRBRD Scorer",
          desc:"Professional broadcast-grade live scoring interface with wagon wheel, AI commentary, player profiles, phase analysis and over-by-over history.",
          color:D.sky,
          icon:"📱",
        },
        {
          name:"SCRBRD OS",
          desc:"Comprehensive school cricket management hub: squad, analytics, injuries, training, logistics, fields, staff, leagues, calendar and notifications.",
          color:D.violet,
          icon:"⚙️",
        },
      ],
      accent:D.sky,
    },
    {
      id:"roles", type:"grid",
      title:"Who Uses SCRBRD?",
      icon:"👥",
      items:[
        { icon:"⚡",  label:"Super Admin",      desc:"Full system control, user management, audit" },
        { icon:"🏫",  label:"School Admin",     desc:"Fixtures, squads, logistics, broadcasts" },
        { icon:"🏅",  label:"Sportsmaster",     desc:"Team management, fixtures, competitions" },
        { icon:"🎯",  label:"Head Coach",       desc:"Analytics, skills, training, injury tracking" },
        { icon:"🤝",  label:"Coaching Asst",    desc:"Training sessions, squad support, profiles" },
        { icon:"🏏",  label:"Player",           desc:"Personal stats, form, training, calendar" },
        { icon:"👪",  label:"Parent",          desc:"Match updates, logistics, child's profile" },
        { icon:"📋",  label:"Scorer",           desc:"Match scoring, ball entry, scorecards" },
        { icon:"🌿",  label:"Groundskeeper",    desc:"Pitch profiles, ground tasks, field status" },
        { icon:"⚕️",  label:"Medical Staff",    desc:"Injury management, clearance, fitness" },
      ],
      accent:D.amber,
    },
    {
      id:"analytics", type:"content",
      title:"Analytics & Intelligence",
      icon:"📊",
      points:[
        "Real-time run rate, required run rate and win probability",
        "Player wagon wheel: per-shot, per-zone, per-bowler breakdown",
        "Phase analysis: Powerplay / Middle / Death performance split",
        "Partnership tracker with ball-by-ball boundary rate",
        "AI-generated broadcast commentary via Claude",
        "Opposition scouting dashboard — H2H records, strengths/weaknesses",
      ],
      accent:D.indigo,
    },
    {
      id:"traction", type:"stats",
      title:"Hilton Pilot — Season Stats",
      icon:"🏆",
      stats:[
        { value:"3",    label:"Teams",          sub:"U13A · U15A · U19A" },
        { value:"18",   label:"Players",        sub:"Hilton + Westville" },
        { value:"8",    label:"Matches",        sub:"This season" },
        { value:"15",   label:"Users",          sub:"Across all roles" },
        { value:"4",    label:"Leagues",        sub:"KZN competitions" },
        { value:"16",   label:"Platform Modules",sub:"Live in OS" },
      ],
      accent:D.emerald,
    },
    {
      id:"roadmap", type:"content",
      title:"Roadmap",
      icon:"🚀",
      points:[
        "🔴 AI post-match report generator (PDF export with insights)",
        "🔴 Live score sync between SCRBRD Scorer and OS hub",
        "🔴 Parent broadcast push notifications (WhatsApp / Email)",
        "🟡 CricHQ and PlayHQ data sync integration",
        "🟡 Video clip tagging tied to ball-by-ball data",
        "🟡 Opposition scouting AI with automated pre-match reports",
        "🔵 Multi-school license model for provincial rollout",
      ],
      accent:D.violet,
    },
    {
      id:"cta", type:"cover",
      title:"Ready to Transform Your Cricket?",
      sub:"SCRBRD — Built for Schools. Powered by Intelligence.",
      body:"Contact us to arrange a demonstration for your school cricket programme. Pilot pricing available for KZN schools in 2026.",
      accent:D.violet,
      cta:"📧 scrbrd@hilton.co.za",
    },
  ];

  const s = SLIDES[slide];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      {/* Slide nav */}
      <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
        <button onClick={()=>setSlide(Math.max(0,slide-1))} className="pressBtn" disabled={slide===0} style={{padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"10px",color:D.textMuted}}>← Prev</button>
        <div style={{display:"flex",gap:"5px",flex:1,flexWrap:"wrap",justifyContent:"center"}}>
          {SLIDES.map((sl,i)=>(
            <button key={sl.id} onClick={()=>setSlide(i)} className="pressBtn" style={{width:"10px",height:"10px",borderRadius:"50%",padding:0,cursor:"pointer",border:"none",background:i===slide?D.violet:"rgba(255,255,255,0.2)",transition:"all .18s"}}/>
          ))}
        </div>
        <button onClick={()=>setSlide(Math.min(SLIDES.length-1,slide+1))} className="pressBtn" disabled={slide===SLIDES.length-1} style={{padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"10px",color:D.textMuted}}>Next →</button>
        <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{slide+1}/{SLIDES.length}</div>
      </div>

      {/* Slide */}
      <div style={{borderRadius:D.xl,border:`1px solid ${s.accent}33`,background:`linear-gradient(135deg,${s.accent}08,${D.surf1} 60%)`,minHeight:"420px",padding:"40px",display:"flex",flexDirection:"column",justifyContent:"center",position:"relative",overflow:"hidden"}}>
        {/* Decorative circle */}
        <div style={{position:"absolute",top:"-40px",right:"-40px",width:"200px",height:"200px",borderRadius:"50%",background:`${s.accent}08`,pointerEvents:"none"}}/>

        {s.type==="cover"&&(
          <div style={{textAlign:"center",maxWidth:"600px",margin:"0 auto"}}>
            <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"48px",objectFit:"contain",marginBottom:"24px",filter:"brightness(1.2)"}}/>
            <div style={{fontFamily:D.head,fontSize:"clamp(26px,4vw,40px)",fontWeight:800,color:D.textPrimary,lineHeight:1.1,marginBottom:"12px"}}>{s.title}</div>
            <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:600,color:s.accent,marginBottom:"12px"}}>{s.sub}</div>
            <div style={{fontFamily:D.body,fontSize:"14px",color:D.textSecondary,lineHeight:1.7,marginBottom:"16px"}}>{s.body}</div>
            {s.cta&&<div style={{fontFamily:D.mono,fontSize:"13px",color:s.accent,padding:"10px 20px",borderRadius:D.pill,border:`1px solid ${s.accent}55`,display:"inline-block"}}>{s.cta}</div>}
          </div>
        )}

        {s.type==="content"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:"14px",marginBottom:"28px"}}>
              <div style={{fontSize:"36px"}}>{s.icon}</div>
              <div style={{fontFamily:D.head,fontSize:"clamp(22px,3vw,32px)",fontWeight:800,color:D.textPrimary}}>{s.title}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
              {s.points.map((p,i)=>(
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:"12px"}}>
                  <div style={{width:"8px",height:"8px",borderRadius:"50%",background:s.accent,marginTop:"6px",flexShrink:0}}/>
                  <div style={{fontFamily:D.body,fontSize:"15px",color:D.textSecondary,lineHeight:1.6}}>{p}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {s.type==="split"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:"14px",marginBottom:"28px"}}>
              <div style={{fontSize:"36px"}}>{s.icon}</div>
              <div style={{fontFamily:D.head,fontSize:"clamp(22px,3vw,32px)",fontWeight:800,color:D.textPrimary}}>{s.title}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:"20px"}}>
              {s.items.map((item,i)=>(
                <div key={i} style={{borderRadius:D.lg,border:`1px solid ${item.color}44`,background:`${item.color}08`,padding:"24px"}}>
                  <div style={{fontSize:"32px",marginBottom:"10px"}}>{item.icon}</div>
                  <div style={{fontFamily:D.head,fontSize:"18px",fontWeight:800,color:item.color,marginBottom:"8px"}}>{item.name}</div>
                  <div style={{fontFamily:D.body,fontSize:"14px",color:D.textSecondary,lineHeight:1.6}}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {s.type==="grid"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:"14px",marginBottom:"24px"}}>
              <div style={{fontSize:"32px"}}>{s.icon}</div>
              <div style={{fontFamily:D.head,fontSize:"clamp(20px,3vw,30px)",fontWeight:800,color:D.textPrimary}}>{s.title}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:"12px"}}>
              {s.items.map((item,i)=>(
                <div key={i} style={{borderRadius:D.md,border:`1px solid ${D.border}`,background:D.surf2,padding:"14px"}}>
                  <div style={{fontSize:"22px",marginBottom:"6px"}}>{item.icon}</div>
                  <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"4px"}}>{item.label}</div>
                  <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,lineHeight:1.5}}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {s.type==="stats"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:"14px",marginBottom:"28px"}}>
              <div style={{fontSize:"36px"}}>{s.icon}</div>
              <div style={{fontFamily:D.head,fontSize:"clamp(22px,3vw,32px)",fontWeight:800,color:D.textPrimary}}>{s.title}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"16px"}}>
              {s.stats.map((st,i)=>(
                <div key={i} style={{borderRadius:D.lg,border:`1px solid ${s.accent}33`,background:`${s.accent}08`,padding:"20px",textAlign:"center"}}>
                  <div style={{fontFamily:D.mono,fontSize:"36px",fontWeight:700,color:s.accent,lineHeight:1}}>{st.value}</div>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textPrimary,marginTop:"6px"}}>{st.label}</div>
                  <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"2px"}}>{st.sub}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  LANDING PAGE
// ══════════════════════════════════════════════════════
function LandingPage({ onEnter, onLogin }) {
  const [hov, setHov] = useState(null);
  const FEATURES = [
    { icon:"🏏", title:"Live Scoring",     desc:"Ball-by-ball broadcast scoring with AI commentary" },
    { icon:"📊", title:"Player Analytics", desc:"Wagon wheel, phase analysis, shot breakdown by zone" },
    { icon:"👥", title:"Squad Management", desc:"Profiles, skills matrix, development tracking" },
    { icon:"🏥", title:"Injury Tracking",  desc:"Medical logs, return-to-play, fitness reporting" },
    { icon:"🚌", title:"Logistics",        desc:"Transport scheduling, venues, kit allocation" },
    { icon:"📅", title:"Smart Calendar",   desc:"Fixtures, training, events in one unified view" },
    { icon:"📋", title:"League Manager",   desc:"Standings, brackets, fixtures, top performers" },
    { icon:"📡", title:"Alerts",           desc:"Push notifications to players, parents and staff" },
  ];
  return (
    <div style={{minHeight:"100vh",background:"#03050c",display:"flex",flexDirection:"column",overflowY:"auto"}}>
      <div style={{display:"flex",alignItems:"center",padding:"18px 32px",borderBottom:"1px solid rgba(255,255,255,0.06)",position:"sticky",top:0,background:"rgba(3,5,12,0.92)",backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",zIndex:10}}>
        <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"26px",objectFit:"contain",filter:"brightness(1.15)"}}/>
        <div style={{marginLeft:"auto",display:"flex",gap:"10px"}}>
          <button onClick={onLogin} className="pressBtn" style={{padding:"8px 18px",borderRadius:"20px",cursor:"pointer",background:"transparent",border:"1px solid rgba(255,255,255,0.15)",fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,color:"rgba(255,255,255,0.7)"}}>Log In</button>
          <button onClick={onEnter} className="pressBtn" style={{padding:"8px 20px",borderRadius:"20px",cursor:"pointer",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,color:"#fff",boxShadow:"0 4px 20px rgba(99,102,241,0.4)"}}>Get Started →</button>
        </div>
      </div>
      <div style={{textAlign:"center",padding:"80px 24px 60px",maxWidth:"900px",margin:"0 auto"}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:"8px",padding:"6px 16px",borderRadius:"20px",background:"rgba(99,102,241,0.12)",border:"1px solid rgba(99,102,241,0.3)",marginBottom:"28px"}}>
          <div style={{width:"6px",height:"6px",borderRadius:"50%",background:"#6366f1",boxShadow:"0 0 8px #6366f1"}}/>
          <span style={{fontFamily:"'Syne',sans-serif",fontSize:"11px",fontWeight:700,color:"#a5b4fc",letterSpacing:"0.1em",textTransform:"uppercase"}}>The Cricket OS for Schools · Season 2026</span>
        </div>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:"clamp(36px,6vw,72px)",fontWeight:800,color:"#fff",lineHeight:1.05,letterSpacing:"-0.02em",marginBottom:"20px"}}>
          Cricket, Intelligently
          <span style={{display:"block",background:"linear-gradient(90deg,#6366f1,#06b6d4,#10b981)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}> Managed.</span>
        </div>
        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"17px",color:"rgba(255,255,255,0.55)",lineHeight:1.7,maxWidth:"600px",margin:"0 auto 36px"}}>
          SCRBRD is the all-in-one cricket operating system for schools — live scoring, analytics, squad management, logistics and communication in a single platform.
        </div>
        <div style={{display:"flex",gap:"14px",justifyContent:"center",flexWrap:"wrap"}}>
          <button onClick={onEnter} className="pressBtn" style={{padding:"14px 32px",borderRadius:"24px",cursor:"pointer",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",fontFamily:"'Syne',sans-serif",fontSize:"14px",fontWeight:700,color:"#fff",boxShadow:"0 6px 32px rgba(99,102,241,0.4)",letterSpacing:"0.04em"}}>🏏 Get Started — It's Free</button>
          <button onClick={onLogin} className="pressBtn" style={{padding:"14px 32px",borderRadius:"24px",cursor:"pointer",background:"transparent",border:"1px solid rgba(255,255,255,0.15)",fontFamily:"'Syne',sans-serif",fontSize:"14px",fontWeight:700,color:"rgba(255,255,255,0.7)"}}>Log In to My School →</button>
        </div>
      </div>
      <div style={{padding:"20px 24px 60px",maxWidth:"1000px",margin:"0 auto",width:"100%"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(255,255,255,0.3)",textAlign:"center",marginBottom:"32px"}}>Everything your cricket programme needs</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:"14px"}}>
          {FEATURES.map((f,i)=>(
            <div key={i} onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}
              style={{borderRadius:"14px",border:`1px solid ${hov===i?"rgba(99,102,241,0.4)":"rgba(255,255,255,0.06)"}`,background:hov===i?"rgba(99,102,241,0.08)":"rgba(255,255,255,0.02)",padding:"20px",transition:"all .2s"}}>
              <div style={{fontSize:"26px",marginBottom:"10px"}}>{f.icon}</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"13px",fontWeight:700,color:"#fff",marginBottom:"5px"}}>{f.title}</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:"rgba(255,255,255,0.45)",lineHeight:1.5}}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{borderTop:"1px solid rgba(255,255,255,0.06)",padding:"24px",textAlign:"center"}}>
        <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"18px",objectFit:"contain",opacity:0.35,filter:"grayscale(1) brightness(2)",display:"block",margin:"0 auto 10px"}}/>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"rgba(255,255,255,0.2)",letterSpacing:"0.08em"}}>© 2026 SCRBRD · School Cricket Intelligence Platform</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  LOGIN PAGE  (mock auth — OAuth simulation)
// ══════════════════════════════════════════════════════
function LoginPage({ onLogin, onSignUp }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  // Mock credentials map: email → {role, name}
  const MOCK_USERS = {
    "admin@hilton.co.za":       { role:"superadmin",    name:"Admin User",            pw:"admin123" },
    "gsutherland@hilton.co.za": { role:"sportsmaster",  name:"Graham Sutherland",     pw:"sports123" },
    "c.hendricks@hilton.co.za": { role:"coach",         name:"Craig Hendricks",       pw:"coach123" },
    "james@hilton.co.za":       { role:"player",        name:"James Whitfield",       pw:"player123" },
    "helen.w@gmail.com":        { role:"parent",        name:"Helen Whitfield",       pw:"parent123" },
    "bwessels@hilton.co.za":    { role:"scorer",        name:"Brian Wessels",         pw:"scorer123" },
    "emzimba@hilton.co.za":     { role:"groundskeeper", name:"Ernest Mzimba",         pw:"ground123" },
    "skhumalo@hilton.co.za":    { role:"medical",       name:"Dr Khumalo",            pw:"medic123" },
  };

  const handleLogin = async () => {
    setLoading(true); setError("");
    await new Promise(r=>setTimeout(r,700));
    const user = MOCK_USERS[email.toLowerCase()];
    if (user && user.pw === password) {
      onLogin(user.role, user.name);
    } else if (user) {
      setError("Incorrect password. Try: " + user.pw);
    } else {
      setError("No account found. Sign up or try a demo account below.");
    }
    setLoading(false);
  };

  const handleGoogleOAuth = async () => {
    setOauthLoading(true);
    await new Promise(r=>setTimeout(r,1200));
    // Simulate Google OAuth — returns schooladmin for demo
    onLogin("schooladmin","Demo User (Google)");
    setOauthLoading(false);
  };

  const DEMO_ACCOUNTS = [
    { role:"superadmin",   email:"admin@hilton.co.za",       pw:"admin123",   label:"Super Admin" },
    { role:"coach",        email:"c.hendricks@hilton.co.za", pw:"coach123",   label:"Head Coach" },
    { role:"player",       email:"james@hilton.co.za",       pw:"player123",  label:"Player" },
    { role:"parent",       email:"helen.w@gmail.com",        pw:"parent123",  label:"Parent" },
  ];

  return (
    <div style={{minHeight:"100vh",background:"#03050c",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
      <div style={{width:"100%",maxWidth:"420px"}}>
        <div style={{textAlign:"center",marginBottom:"32px"}}>
          <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"30px",objectFit:"contain",filter:"brightness(1.15)",marginBottom:"16px"}}/>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:"22px",fontWeight:800,color:"#fff",marginBottom:"6px"}}>Welcome back</div>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.45)"}}>Sign in to your SCRBRD account</div>
        </div>

        <div style={{borderRadius:"20px",border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.02)",padding:"28px",backdropFilter:"blur(20px)"}}>
          {/* Google OAuth button */}
          <button onClick={handleGoogleOAuth} disabled={oauthLoading} className="pressBtn" style={{width:"100%",padding:"12px",borderRadius:"12px",cursor:"pointer",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",display:"flex",alignItems:"center",justifyContent:"center",gap:"10px",marginBottom:"20px",transition:"all .2s"}}>
            <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/><path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
            <span style={{fontFamily:"'Syne',sans-serif",fontSize:"13px",fontWeight:700,color:"rgba(255,255,255,0.85)"}}>{oauthLoading?"Connecting…":"Continue with Google"}</span>
          </button>

          <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"20px"}}>
            <div style={{flex:1,height:"1px",background:"rgba(255,255,255,0.08)"}}/>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"rgba(255,255,255,0.3)"}}>or email</span>
            <div style={{flex:1,height:"1px",background:"rgba(255,255,255,0.08)"}}/>
          </div>

          {/* Email + password */}
          {[
            { label:"Email", type:"email",    value:email,    onChange:setEmail,    placeholder:"you@school.co.za" },
            { label:"Password", type:"password", value:password, onChange:setPassword, placeholder:"••••••••" },
          ].map(f=>(
            <div key={f.label} style={{marginBottom:"14px"}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:"6px"}}>{f.label}</div>
              <input value={f.value} type={f.type} onChange={e=>f.onChange(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleLogin()}
                placeholder={f.placeholder}
                style={{width:"100%",padding:"11px 14px",borderRadius:"10px",background:"rgba(255,255,255,0.05)",border:`1px solid ${error?"rgba(244,63,94,0.5)":"rgba(255,255,255,0.1)"}`,fontFamily:"'DM Sans',sans-serif",fontSize:"14px",color:"#fff",outline:"none",boxSizing:"border-box"}}/>
            </div>
          ))}

          {error&&<div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:"#f87171",marginBottom:"12px",padding:"8px 12px",borderRadius:"8px",background:"rgba(244,63,94,0.1)",border:"1px solid rgba(244,63,94,0.2)"}}>{error}</div>}

          <button onClick={handleLogin} disabled={loading} className="pressBtn" style={{width:"100%",padding:"12px",borderRadius:"12px",cursor:"pointer",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",fontFamily:"'Syne',sans-serif",fontSize:"13px",fontWeight:700,color:"#fff",marginBottom:"14px",boxShadow:"0 4px 20px rgba(99,102,241,0.35)"}}>
            {loading?"Signing in…":"Sign In"}
          </button>

          <div style={{textAlign:"center"}}>
            <button onClick={onSignUp} className="pressBtn" style={{background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:"rgba(255,255,255,0.4)"}}>
              New to SCRBRD? <span style={{color:"#a5b4fc",fontWeight:600}}>Create an account →</span>
            </button>
          </div>
        </div>

        {/* Demo accounts */}
        <div style={{marginTop:"20px",borderRadius:"14px",border:"1px solid rgba(99,102,241,0.2)",background:"rgba(99,102,241,0.05)",padding:"16px"}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(99,102,241,0.7)",marginBottom:"10px"}}>✦ Demo Accounts — click to fill</div>
          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"6px"}}>
            {DEMO_ACCOUNTS.map(d=>(
              <button key={d.role} onClick={()=>{setEmail(d.email);setPassword(d.pw);setError("");}} className="pressBtn"
                style={{padding:"7px 10px",borderRadius:"8px",cursor:"pointer",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",textAlign:"left"}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,color:"rgba(255,255,255,0.7)"}}>{ROLES[d.role]?.icon} {d.label}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"rgba(255,255,255,0.3)",marginTop:"2px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.email}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  ONBOARDING FLOW  (smart, dynamic, role-aware)
// ══════════════════════════════════════════════════════
function OnboardingFlow({ onComplete }) {
  const [step,   setStep]   = useState(0);
  const [data,   setData]   = useState({
    role: null, name: "", email: "", schoolId: null, schoolCustom: "",
    team: "", playerLink: "", inviteCode: "", jersey: "",
  });
  const [schoolSearch, setSchoolSearch] = useState("");
  const [codeError,    setCodeError]    = useState("");
  const set = (k,v) => setData(d=>({...d,[k]:v}));

  // Roles available for self-registration (NO superadmin — only SA can assign SA)
  const PUBLIC_ROLES = [
    { id:"schooladmin",  icon:"🏫", label:"School Admin",       desc:"Manage your school's cricket programme",  requiresCode:true  },
    { id:"sportsmaster", icon:"🏅", label:"Sportsmaster",       desc:"Oversee teams, fixtures & competitions",  requiresCode:true  },
    { id:"coach",        icon:"🎯", label:"Head Coach",         desc:"Player development, analytics & tactics",  requiresCode:false },
    { id:"assistant",    icon:"🤝", label:"Coaching Assistant", desc:"Training support & squad management",      requiresCode:false },
    { id:"player",       icon:"🏏", label:"Player",             desc:"Track your own stats, form & development", requiresCode:false },
    { id:"parent",       icon:"👪", label:"Parent / Guardian",  desc:"Follow your child's matches & logistics",  requiresCode:false },
    { id:"scorer",       icon:"📋", label:"Official Scorer",    desc:"Score matches, submit scorecards",         requiresCode:false },
    { id:"medical",      icon:"⚕️", label:"Medical Staff",      desc:"Manage injuries and player fitness",        requiresCode:false },
    { id:"groundskeeper",icon:"🌿", label:"Groundskeeper",      desc:"Pitch prep, field management & tasks",     requiresCode:false },
    { id:"spectator",    icon:"👁", label:"Spectator / Fan",    desc:"View scores, stats and fixtures",          requiresCode:false },
  ];

  // Invite codes for elevated roles
  const INVITE_CODES = { schooladmin:"HILTADMIN26", sportsmaster:"SPORTS2026" };

  const selectedRole = PUBLIC_ROLES.find(r=>r.id===data.role);
  const needsCode = selectedRole?.requiresCode && !data.inviteCode;
  const ri = ROLES[data.role] || {};

  const filteredSchools = SCHOOLS_REGISTRY.filter(s=>
    s.name.toLowerCase().includes(schoolSearch.toLowerCase()) ||
    s.city.toLowerCase().includes(schoolSearch.toLowerCase()) ||
    s.province.toLowerCase().includes(schoolSearch.toLowerCase())
  );

  // Dynamic steps based on role
  const getSteps = () => {
    const base = ["welcome","role","school","profile"];
    if (data.role==="player")   return [...base,"player_detail","tour"];
    if (data.role==="parent")   return [...base,"parent_link","tour"];
    if (selectedRole?.requiresCode) return ["welcome","role","invite","school","profile","tour"];
    return [...base,"tour"];
  };
  const steps = getSteps();
  const stepId = steps[step];
  const progress = step / (steps.length - 1);

  const canAdvance = () => {
    if (stepId==="role")        return !!data.role;
    if (stepId==="invite")      return !!data.inviteCode;
    if (stepId==="school")      return !!data.schoolId;
    if (stepId==="profile")     return data.name.length >= 2;
    return true;
  };

  const handleNext = () => {
    if (stepId==="invite") {
      const expected = INVITE_CODES[data.role];
      if (data.inviteCode !== expected) { setCodeError(`Invalid code. Contact your School Admin.`); return; }
      setCodeError("");
    }
    if (step < steps.length - 1) setStep(s=>s+1);
    else onComplete(data.role, data.name, data.schoolId||data.schoolCustom);
  };

  const TOUR_MAP = {
    player:       [{icon:"📊",t:"Analytics",d:"Your wagon wheel, phase breakdown and shot analysis"},{icon:"💪",t:"Training",d:"Session plans and skill development goals"},{icon:"🏥",t:"Injuries",d:"Your fitness status and return-to-play timeline"}],
    parent:       [{icon:"🏏",t:"Match Centre",d:"Live scores and full scorecards"},{icon:"🚌",t:"Logistics",d:"Transport times and venues"},{icon:"🔔",t:"Notifications",d:"Real-time alerts for your child"}],
    coach:        [{icon:"👥",t:"Squad View",d:"Full team with skills, form and availability"},{icon:"📊",t:"Analytics",d:"Team and player performance breakdowns"},{icon:"💪",t:"Training",d:"Session planner and attendance tracker"}],
    scorer:       [{icon:"🏏",t:"Match Centre",d:"Open the live scoring interface"},{icon:"📅",t:"Calendar",d:"Your assigned match schedule"}],
    groundskeeper:[{icon:"🌿",t:"Fields",d:"Pitch profiles and preparation status"},{icon:"🛠️",t:"Management",d:"Ground task assignments and scheduling"}],
    default:      [{icon:"⬡",t:"Dashboard",d:"Live scores and team news at a glance"},{icon:"📅",t:"Calendar",d:"All fixtures, training and events"},{icon:"🔔",t:"Notifications",d:"Match alerts and announcements"}],
  };
  const tourItems = TOUR_MAP[data.role] || TOUR_MAP.default;

  const INP = { width:"100%",padding:"11px 14px",borderRadius:"10px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",fontFamily:"'DM Sans',sans-serif",fontSize:"14px",color:"#fff",outline:"none",boxSizing:"border-box" };

  return (
    <div style={{minHeight:"100vh",background:"#03050c",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",overflowY:"auto"}}>
      <div style={{width:"100%",maxWidth:"600px"}}>
        {/* Progress */}
        <div style={{display:"flex",gap:"3px",marginBottom:"28px"}}>
          {steps.map((_,i)=>(
            <div key={i} style={{flex:1,height:"3px",borderRadius:"2px",background:i<=step?"linear-gradient(90deg,#6366f1,#8b5cf6)":"rgba(255,255,255,0.08)",transition:"background .3s"}}/>
          ))}
        </div>

        <div style={{borderRadius:"20px",border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.02)",padding:"32px",backdropFilter:"blur(20px)"}}>
          <div style={{textAlign:"center",marginBottom:"24px"}}>
            <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"28px",objectFit:"contain",filter:"brightness(1.15)"}}/>
          </div>

          {/* ── WELCOME ── */}
          {stepId==="welcome"&&(
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:"52px",marginBottom:"16px"}}>🏏</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"24px",fontWeight:800,color:"#fff",marginBottom:"8px"}}>Welcome to SCRBRD</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"14px",color:"rgba(255,255,255,0.5)",lineHeight:1.7,maxWidth:"420px",margin:"0 auto"}}>
                Set up your account in under 2 minutes. We'll tailor the platform to your role and school.
              </div>
            </div>
          )}

          {/* ── ROLE SELECTION ── */}
          {stepId==="role"&&(
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",textAlign:"center",marginBottom:"6px"}}>What's your role?</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.4)",textAlign:"center",marginBottom:"20px"}}>This shapes your experience. Super Admin access is assigned by your school's administrator.</div>
              <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"8px",maxHeight:"380px",overflowY:"auto",paddingRight:"4px"}}>
                {PUBLIC_ROLES.map(r=>(
                  <button key={r.id} onClick={()=>set("role",r.id)} className="pressBtn" style={{
                    display:"flex",alignItems:"flex-start",gap:"10px",padding:"12px 14px",borderRadius:"12px",
                    cursor:"pointer",border:`1px solid ${data.role===r.id?"rgba(99,102,241,0.55)":"rgba(255,255,255,0.07)"}`,
                    background:data.role===r.id?"rgba(99,102,241,0.14)":"rgba(255,255,255,0.02)",textAlign:"left",transition:"all .18s",
                  }}>
                    <span style={{fontSize:"20px",flexShrink:0,marginTop:"1px"}}>{r.icon}</span>
                    <div>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:"11px",fontWeight:700,color:data.role===r.id?"#a5b4fc":"rgba(255,255,255,0.85)"}}>{r.label}</div>
                      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"10px",color:"rgba(255,255,255,0.35)",marginTop:"2px",lineHeight:1.4}}>{r.desc}</div>
                      {r.requiresCode&&<div style={{marginTop:"5px",padding:"2px 6px",borderRadius:"4px",background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.3)",display:"inline-block",fontFamily:"'Syne',sans-serif",fontSize:"8px",fontWeight:700,color:"#fbbf24"}}>🔑 Invite code required</div>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── INVITE CODE ── */}
          {stepId==="invite"&&(
            <div>
              <div style={{textAlign:"center",marginBottom:"20px"}}>
                <div style={{fontSize:"36px",marginBottom:"10px"}}>🔑</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",marginBottom:"8px"}}>Invite Code Required</div>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.45)",lineHeight:1.6}}>
                  The <strong style={{color:ri.color||"#a5b4fc"}}>{ri.label}</strong> role requires an invite code.<br/>Your school's Super Admin will have provided this.
                </div>
              </div>
              <div style={{marginBottom:"6px"}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:"6px"}}>Invite Code</div>
                <input value={data.inviteCode} onChange={e=>{set("inviteCode",e.target.value.toUpperCase());setCodeError("");}}
                  placeholder="e.g. HILTADMIN26" style={{...INP,fontFamily:"'DM Mono',monospace",letterSpacing:"0.1em"}}/>
                {codeError&&<div style={{marginTop:"6px",fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:"#f87171"}}>{codeError}</div>}
              </div>
              <div style={{marginTop:"12px",padding:"10px 14px",borderRadius:"10px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"11px",color:"rgba(255,255,255,0.35)",lineHeight:1.5}}>
                  Don't have a code? Contact your school's cricket administrator or email <span style={{color:"#a5b4fc"}}>support@scrbrd.co.za</span>
                </div>
              </div>
            </div>
          )}

          {/* ── SCHOOL SELECTION ── */}
          {stepId==="school"&&(
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",textAlign:"center",marginBottom:"6px"}}>Your School</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.4)",textAlign:"center",marginBottom:"16px"}}>Search from {SCHOOLS_REGISTRY.length} schools across South Africa</div>
              <input value={schoolSearch} onChange={e=>setSchoolSearch(e.target.value)}
                placeholder="Search by name, city or province…"
                style={{...INP,marginBottom:"10px"}}/>
              <div style={{maxHeight:"260px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"4px",paddingRight:"4px"}}>
                {filteredSchools.map(s=>(
                  <button key={s.id} onClick={()=>{set("schoolId",s.id);set("schoolCustom",s.name);}} className="pressBtn" style={{
                    display:"flex",alignItems:"center",gap:"12px",padding:"10px 14px",borderRadius:"10px",
                    cursor:"pointer",border:`1px solid ${data.schoolId===s.id?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.06)"}`,
                    background:data.schoolId===s.id?"rgba(99,102,241,0.12)":"rgba(255,255,255,0.02)",textAlign:"left",transition:"all .15s",
                  }}>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,color:data.schoolId===s.id?"#a5b4fc":"rgba(255,255,255,0.85)"}}>{s.name}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"rgba(255,255,255,0.3)",marginTop:"2px"}}>{s.city} · {s.province} · {s.type}</div>
                    </div>
                    {data.schoolId===s.id&&<span style={{color:"#6366f1",fontSize:"16px"}}>✓</span>}
                  </button>
                ))}
                {filteredSchools.length===0&&(
                  <div style={{padding:"16px",textAlign:"center",fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.3)"}}>
                    No schools found. <button onClick={()=>{set("schoolId","OTH");set("schoolCustom",schoolSearch);}} className="pressBtn" style={{background:"none",border:"none",cursor:"pointer",color:"#a5b4fc",fontFamily:"'DM Sans',sans-serif",fontSize:"13px"}}>Add "{schoolSearch}" manually →</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── PROFILE ── */}
          {stepId==="profile"&&(
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",textAlign:"center",marginBottom:"6px"}}>Your Profile</div>
              {data.role&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",marginBottom:"18px"}}>
                <span style={{padding:"4px 12px",borderRadius:D.pill,background:`${ri.color||"#6366f1"}18`,border:`1px solid ${ri.color||"#6366f1"}33`,fontFamily:"'Syne',sans-serif",fontSize:"11px",fontWeight:700,color:ri.color||"#a5b4fc"}}>{ri.icon} {ri.label}</span>
                {data.schoolCustom&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"rgba(255,255,255,0.35)"}}>{data.schoolCustom}</span>}
              </div>}
              {[
                {label:"Full Name",       key:"name",   type:"text",  placeholder:"e.g. James Whitfield",      required:true},
                {label:"Email Address",   key:"email",  type:"email", placeholder:"james@school.co.za",         required:false},
              ].map(f=>(
                <div key={f.key} style={{marginBottom:"14px"}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:"6px"}}>{f.label}{f.required&&" *"}</div>
                  <input value={data[f.key]} type={f.type} onChange={e=>set(f.key,e.target.value)} placeholder={f.placeholder} style={INP}/>
                </div>
              ))}
            </div>
          )}

          {/* ── PLAYER DETAIL ── */}
          {stepId==="player_detail"&&(
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",textAlign:"center",marginBottom:"20px"}}>Player Details</div>
              {[
                {label:"Team / Age Group",  key:"team",   placeholder:"e.g. U19A, U15B, 1st XI"},
                {label:"Jersey Number",     key:"jersey", placeholder:"e.g. 7"},
              ].map(f=>(
                <div key={f.key} style={{marginBottom:"14px"}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:"6px"}}>{f.label}</div>
                  <input value={data[f.key]} onChange={e=>set(f.key,e.target.value)} placeholder={f.placeholder} style={INP}/>
                </div>
              ))}
              <div style={{marginBottom:"14px"}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:"8px"}}>Batting / Bowling Role</div>
                <div style={{display:"grid",gridTemplateColumns:"var(--g-3,repeat(3,1fr))",gap:"6px"}}>
                  {["Batsman","Bowler","All-rounder","Wicketkeeper","Opening Bat","Pace Bowler"].map(r=>(
                    <button key={r} onClick={()=>set("playerRole",r)} className="pressBtn" style={{padding:"8px 6px",borderRadius:"8px",cursor:"pointer",border:`1px solid ${data.playerRole===r?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.07)"}`,background:data.playerRole===r?"rgba(99,102,241,0.14)":"transparent",fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:600,color:data.playerRole===r?"#a5b4fc":"rgba(255,255,255,0.5)"}}>{r}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── PARENT LINK ── */}
          {stepId==="parent_link"&&(
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",textAlign:"center",marginBottom:"8px"}}>Link to Player</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.4)",textAlign:"center",marginBottom:"20px"}}>Optionally link your account to your child's player profile for personalised updates.</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:"8px"}}>Search Player Name</div>
              <input value={data.playerLink} onChange={e=>set("playerLink",e.target.value)} placeholder="e.g. James Whitfield" style={{...INP,marginBottom:"10px"}}/>
              {data.playerLink.length>1&&(
                <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
                  {PLAYERS.filter(p=>p.name.toLowerCase().includes(data.playerLink.toLowerCase())).slice(0,5).map(p=>(
                    <button key={p.id} onClick={()=>set("playerLink",p.name)} className="pressBtn" style={{display:"flex",alignItems:"center",gap:"10px",padding:"9px 12px",borderRadius:"9px",cursor:"pointer",border:"1px solid rgba(255,255,255,0.07)",background:"rgba(255,255,255,0.03)",textAlign:"left"}}>
                      <span style={{fontSize:"16px"}}>🏏</span>
                      <div>
                        <div style={{fontFamily:"'Syne',sans-serif",fontSize:"11px",fontWeight:700,color:"rgba(255,255,255,0.8)"}}>{p.name}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"rgba(255,255,255,0.3)"}}>{p.role} · {p.team}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={()=>set("playerLink","skip")} className="pressBtn" style={{width:"100%",marginTop:"12px",padding:"9px",borderRadius:"9px",cursor:"pointer",background:"transparent",border:"1px solid rgba(255,255,255,0.06)",fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:"rgba(255,255,255,0.35)"}}>Skip for now</button>
            </div>
          )}

          {/* ── TOUR ── */}
          {stepId==="tour"&&(
            <div>
              <div style={{textAlign:"center",marginBottom:"20px"}}>
                <div style={{fontSize:"36px",marginBottom:"10px"}}>{ri.icon||"🏏"}</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",marginBottom:"6px"}}>You're all set, {data.name.split(" ")[0]||"there"}!</div>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.4)"}}>Here's what's waiting for you as a <span style={{color:ri.color||"#a5b4fc",fontWeight:600}}>{ri.label}</span></div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {tourItems.map((t,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:"14px",padding:"12px 16px",borderRadius:"12px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
                    <div style={{fontSize:"22px",width:"34px",textAlign:"center",flexShrink:0}}>{t.icon}</div>
                    <div>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,color:"rgba(255,255,255,0.85)"}}>{t.t}</div>
                      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"11px",color:"rgba(255,255,255,0.38)",marginTop:"2px"}}>{t.d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div style={{display:"flex",gap:"10px",marginTop:"14px",justifyContent:"flex-end",alignItems:"center"}}>
          {step>0&&<button onClick={()=>{setStep(s=>s-1);setCodeError("");}} className="pressBtn" style={{padding:"11px 22px",borderRadius:"14px",cursor:"pointer",background:"transparent",border:"1px solid rgba(255,255,255,0.1)",fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,color:"rgba(255,255,255,0.45)"}}>← Back</button>}
          <div style={{flex:1}}/>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"rgba(255,255,255,0.25)"}}>{step+1} / {steps.length}</div>
          <button onClick={handleNext} disabled={!canAdvance()&&stepId!=="tour"} className="pressBtn" style={{
            padding:"11px 26px",borderRadius:"14px",cursor:canAdvance()||stepId==="tour"?"pointer":"not-allowed",
            background:canAdvance()||stepId==="tour"?"linear-gradient(135deg,#6366f1,#8b5cf6)":"rgba(255,255,255,0.08)",
            border:"none",fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,
            color:canAdvance()||stepId==="tour"?"#fff":"rgba(255,255,255,0.3)",
            boxShadow:canAdvance()||stepId==="tour"?"0 4px 20px rgba(99,102,241,0.35)":"none",
            letterSpacing:"0.04em",transition:"all .2s",
          }}>
            {stepId==="tour"?"🏏 Enter SCRBRD →":!canAdvance()&&stepId==="role"?"Select a role →":"Continue →"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════
//  MAIN APP
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  SCRBRD OS SHELL — responsive helpers & mobile nav
// ══════════════════════════════════════════════════════
function useIsMobile(bp = 880) {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(`(max-width:${bp}px)`).matches : false
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width:${bp}px)`);
    const fn = e => setMobile(e.matches);
    mq.addEventListener ? mq.addEventListener("change", fn) : mq.addListener(fn);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", fn) : mq.removeListener(fn); };
  }, [bp]);
  return mobile;
}

const SPORTS = [
  { id:"cricket",  label:"CricketOS",  icon:"🏏", live:true  },
  { id:"football", label:"FootballOS", icon:"⚽",        live:false },
  { id:"rugby",    label:"RugbyOS",    icon:"🏉", live:false },
  { id:"hockey",   label:"HockeyOS",   icon:"🏑", live:false },
];

function SportSwitcher() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{padding:"10px 14px",borderBottom:`1px solid ${D.border}`,position:"relative"}}>
      <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:D.textMuted,marginBottom:"6px"}}>ScrbrdOS · Sport</div>
      <button onClick={()=>setOpen(!open)} className="pressBtn" style={{width:"100%",display:"flex",alignItems:"center",gap:"8px",padding:"7px 10px",borderRadius:D.md,background:D.emerald+"10",border:`1px solid ${D.emerald}28`,cursor:"pointer"}}>
        <span style={{fontSize:"14px"}}>🏏</span>
        <span style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.emerald}}>CricketOS</span>
        <span style={{marginLeft:"auto",fontSize:"9px",color:D.textMuted}}>{open?"▴":"▾"}</span>
      </button>
      {open&&(
        <div style={{position:"absolute",left:"14px",right:"14px",top:"calc(100% - 4px)",zIndex:300,background:D.surf2,border:`1px solid ${D.borderMed}`,borderRadius:D.lg,overflow:"hidden",boxShadow:"0 12px 40px rgba(0,0,0,.5)"}}>
          {SPORTS.map(s=>(
            <button key={s.id} disabled={!s.live} onClick={()=>setOpen(false)} className="pressBtn" style={{width:"100%",display:"flex",alignItems:"center",gap:"8px",padding:"9px 12px",background:s.live?D.emerald+"10":"transparent",border:"none",cursor:s.live?"pointer":"default",opacity:s.live?1:.55}}>
              <span style={{fontSize:"13px"}}>{s.icon}</span>
              <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:s.live?600:400,color:s.live?D.textPrimary:D.textSecondary}}>{s.label}</span>
              {s.live
                ? <span style={{marginLeft:"auto",width:"6px",height:"6px",borderRadius:"50%",background:D.emerald}}/>
                : <span style={{marginLeft:"auto",fontFamily:D.head,fontSize:"7px",fontWeight:700,letterSpacing:"0.1em",color:D.amber,background:D.amber+"16",border:`1px solid ${D.amber}30`,borderRadius:D.pill,padding:"2px 6px"}}>SOON</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileNav({ role, active, onNav, notifCount }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const nav = ROLES[role]?.nav || [];
  const primary = nav.slice(0, 4);
  const rest = nav.slice(4);
  const moreActive = rest.includes(active);
  const Item = ({ k, isMore }) => {
    const m = isMore ? { icon:"☰", label:"More" } : NAV_META[k];
    const isActive = isMore ? moreActive : active===k;
    const isBell = k==="notifications";
    return (
      <button onClick={()=>{ isMore ? setMoreOpen(true) : (setMoreOpen(false), onNav(k)); }} className="pressBtn" style={{
        flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",padding:"7px 2px",
        background:isActive?D.indigo+"16":"transparent",border:"none",borderRadius:D.md,cursor:"pointer",position:"relative",minHeight:"52px",justifyContent:"center"}}>
        <span style={{fontSize:"17px",lineHeight:1,filter:isActive?"none":"grayscale(.5) opacity(.75)"}}>{m.icon}</span>
        <span style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:isActive?D.textPrimary:D.textMuted}}>{m.label}</span>
        {isBell&&notifCount>0&&<span style={{position:"absolute",top:"4px",right:"calc(50% - 16px)",background:D.rose,color:"#fff",borderRadius:D.pill,padding:"0 4px",fontFamily:D.mono,fontSize:"8px",fontWeight:700,minWidth:"13px"}}>{notifCount}</span>}
      </button>
    );
  };
  return (
    <>
      {moreOpen&&(
        <>
          <div className="os-drawer-scrim" onClick={()=>setMoreOpen(false)}/>
          <div className="os-drawer">
            <div style={{width:"36px",height:"4px",borderRadius:D.pill,background:D.borderMed,margin:"0 auto 12px"}}/>
            <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:D.textMuted,margin:"2px 4px 8px"}}>ScrbrdOS · Sport</div>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"14px"}}>
              {SPORTS.map(s=>(
                <span key={s.id} style={{display:"flex",alignItems:"center",gap:"5px",padding:"5px 10px",borderRadius:D.pill,fontFamily:D.head,fontSize:"9px",fontWeight:700,
                  background:s.live?D.emerald+"14":"transparent",border:`1px solid ${s.live?D.emerald+"33":D.border}`,color:s.live?D.emerald:D.textMuted}}>
                  {s.icon} {s.label}{!s.live&&<span style={{fontSize:"7px",color:D.amber}}>SOON</span>}
                </span>
              ))}
            </div>
            <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:D.textMuted,margin:"2px 4px 8px"}}>All modules</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(96px,1fr))",gap:"8px"}}>
              {nav.map(k=>{
                const m = NAV_META[k]; const isActive = active===k;
                return (
                  <button key={k} onClick={()=>{setMoreOpen(false);onNav(k);}} className="pressBtn" style={{
                    display:"flex",flexDirection:"column",alignItems:"center",gap:"6px",padding:"13px 6px",
                    background:isActive?D.indigo+"16":D.surf2,border:`1px solid ${isActive?D.indigo+"33":D.border}`,
                    borderRadius:D.lg,cursor:"pointer"}}>
                    <span style={{fontSize:"18px"}}>{m.icon}</span>
                    <span style={{fontFamily:D.body,fontSize:"10px",fontWeight:isActive?600:400,color:isActive?D.textPrimary:D.textSecondary}}>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
      <div className="os-bottomnav">
        {primary.map(k=><Item key={k} k={k}/>)}
        {rest.length>0&&<Item k="__more" isMore/>}
      </div>
    </>
  );
}


// ══════════════════════════════════════════════════
//  SCRBRD SCORER v3 — embedded live ball-by-ball scoring engine
//  Fully isolated in a module closure: its own tokens (D), primitives
//  (Card/Btn/Badge) and styles never collide with the OS shell.
// ══════════════════════════════════════════════════
const ScorerApp = (() => {


/* ═══════════════════════════════════════════════════════
   DESIGN SYSTEM
═══════════════════════════════════════════════════════ */
const GS = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html{font-size:14px;-webkit-font-smoothing:antialiased}
    body{background:#060910;overflow-x:hidden}
    ::-webkit-scrollbar{width:2px;height:2px}
    ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:99px}
    input,button,textarea,select{font-family:'DM Sans',sans-serif}
    @keyframes dotPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.75);opacity:.45}}
    @keyframes pulseGlow{0%,100%{box-shadow:0 0 6px rgba(52,211,153,.6)}50%{box-shadow:0 0 18px rgba(52,211,153,.3)}}
    @keyframes slideUp{from{transform:translateY(24px);opacity:0}to{transform:translateY(0);opacity:1}}
    @keyframes scoreReveal{from{transform:translateY(-8px) scale(.95);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}
    @keyframes gradShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
    @keyframes badgePop{0%{transform:scale(.8);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
    @keyframes wagonDraw{from{stroke-dashoffset:320}to{stroke-dashoffset:0}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes overlayIn{0%{opacity:0;transform:translate(-50%,-50%) scale(.6)}60%{transform:translate(-50%,-50%) scale(1.08)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}
    @keyframes overlayOut{0%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.3)}}
    @keyframes freeHitPulse{0%,100%{box-shadow:0 0 0 0 rgba(249,115,22,.5)}50%{box-shadow:0 0 0 18px rgba(249,115,22,0)}}
    @keyframes bounceIn{0%{transform:translateY(20px);opacity:0}60%{transform:translateY(-8px)}100%{transform:translateY(0);opacity:1}}
    @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
    @keyframes milestoneIn{0%{opacity:0;transform:translate(-50%,-60%) scale(.5) rotate(-6deg)}60%{transform:translate(-50%,-50%) scale(1.05) rotate(1deg)}100%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(0deg)}}
    @keyframes milestoneOut{0%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.2) translateY(-20px)}}
    @keyframes confetti{0%{transform:translateY(0) rotate(0deg);opacity:1}100%{transform:translateY(60px) rotate(720deg);opacity:0}}
    @keyframes goldShimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
    @keyframes undoPop{0%{transform:scale(.85);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
    .slideUp{animation:slideUp .32s cubic-bezier(.22,1,.36,1) both}
    .scoreAnim{animation:scoreReveal .28s cubic-bezier(.22,1,.36,1) both}
    .liveDot{animation:dotPulse 1.8s ease-in-out infinite}
    .liveGlow{animation:pulseGlow 2s ease-in-out infinite}
    .gradAnim{background-size:200% 200%;animation:gradShift 4s ease infinite}
    .badgePop{animation:badgePop .3s cubic-bezier(.34,1.56,.64,1) both}
    .wagonLine{stroke-dasharray:320;animation:wagonDraw .38s ease both}
    .fadeIn{animation:fadeIn .22s ease both}
    .pressBtn{transition:transform .1s ease,opacity .1s ease}
    .pro-score-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}
    .sc-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
    @media(max-width:900px){.sc-grid-2{grid-template-columns:1fr}}
    @media(max-width:900px){.pro-score-grid{grid-template-columns:1fr}}
    .pressBtn:active:not(:disabled){transform:scale(.95);opacity:.85}
    .pressBtn:disabled{cursor:not-allowed!important;opacity:.38!important}
    .shotBtn{transition:all .15s ease;border:1px solid transparent}
    .shotBtn:hover{border-color:rgba(255,255,255,.15)!important}
    .shotBtn.active{border-color:rgba(79,70,229,.7)!important;background:rgba(79,70,229,.2)!important}
  `}</style>
);

/* Design tokens: inherits the single canonical `D` from module scope
   (unified — no separate scorer palette). */

/* ── Primitives ── */
const Glass = ({ children, style, glow, onClick }) => (
  <div onClick={onClick} style={{
    background:D.glass, backdropFilter:"blur(20px) saturate(1.6)",
    WebkitBackdropFilter:"blur(20px) saturate(1.6)",
    border:`1px solid ${D.border}`, borderRadius:D.xl,
    boxShadow: glow
      ? `0 12px 48px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.07),0 0 60px ${glow}10`
      : "0 8px 32px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06)",
    position:"relative", overflow:"hidden", ...style,
  }}>{children}</div>
);

const Card = ({ children, style, accent }) => (
  <div style={{
    background:D.surf1, border:`1px solid ${accent?`${accent}28`:D.border}`,
    borderRadius:D.lg,
    boxShadow: accent
      ? `0 6px 24px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.05),0 0 32px ${accent}0c`
      : "0 4px 20px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.04)",
    position:"relative", overflow:"hidden", ...style,
  }}>{children}</div>
);

const Lbl = ({ children, sx }) => (
  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.15em",
    textTransform:"uppercase",color:D.textMuted,...sx}}>{children}</div>
);

const Sep = ({ sx }) => <div style={{height:"1px",background:D.border,...sx}} />;

const Badge = ({ children, color, sx }) => (
  <span style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.12em",
    textTransform:"uppercase",padding:"3px 8px",borderRadius:D.pill,
    background:`${color||D.indigo}1e`,color:color||D.indigo,
    border:`1px solid ${color||D.indigo}30`,flexShrink:0,...sx}}>{children}</span>
);

const BallDot = ({ ball, size=28 }) => {
  const m = b => {
    if(b.type==="W")  return {bg:D.rose,   fg:"#fff",   tx:"W"};
    if(b.type==="Wd") return {bg:D.orange,  fg:"#fff",   tx:"Wd"};
    if(b.type==="Nb") return {bg:D.amber,   fg:"#000",   tx:"NB"};
    if(b.type==="Pen")return {bg:D.violet,  fg:"#fff",   tx:`+${b.value}`};
    if(b.value===6)   return {bg:D.amber,   fg:"#000",   tx:"6"};
    if(b.value===4)   return {bg:D.indigo,  fg:"#fff",   tx:"4"};
    if(b.value===0)   return {bg:D.surf3,   fg:D.textMuted,tx:"·"};
    return {bg:`${D.emerald}33`,fg:D.emerald,tx:String(b.value)};
  };
  const{bg,fg,tx}=m(ball);
  const lbl=ball.type==="B"?`${ball.value}b`:ball.type==="LB"?`${ball.value}lb`:tx;
  return (
    <div style={{width:size,height:size,borderRadius:"50%",background:bg,
      display:"flex",alignItems:"center",justifyContent:"center",
      color:fg,fontSize:size*.38,fontFamily:D.mono,fontWeight:500,flexShrink:0,
      boxShadow:(ball.value===6||ball.value===4)?`0 0 10px ${bg}66`:"none"}}>
      {lbl}
    </div>
  );
};

const Btn = ({ children, onClick, disabled, variant="primary", size="md", full, sx }) => {
  const pad = size==="xs"?"5px 10px":size==="sm"?"8px 14px":size==="lg"?"15px 28px":"11px 20px";
  const fs  = size==="xs"?"10px":size==="sm"?"12px":size==="lg"?"15px":"13px";
  const V = {
    primary:{background:disabled?D.surf2:D.grad,color:disabled?D.textMuted:"#fff",border:"none",boxShadow:disabled?"none":"0 4px 24px rgba(79,70,229,.4)"},
    danger: {background:disabled?D.surf2:`linear-gradient(135deg,${D.rose},#dc2626)`,color:disabled?D.textMuted:"#fff",border:"none",boxShadow:disabled?"none":`0 4px 20px ${D.rose}40`},
    ghost:  {background:"transparent",color:D.textSecondary,border:`1px solid ${D.border}`},
    tonal:  {background:D.surf2,color:D.textPrimary,border:`1px solid ${D.borderMed}`},
    live:   {background:disabled?D.surf2:D.gradLive,color:disabled?D.textMuted:"#fff",border:"none",boxShadow:disabled?"none":`0 4px 20px ${D.emerald}40`},
    amber:  {background:disabled?D.surf2:`${D.amber}1a`,color:disabled?D.textMuted:D.amber,border:`1px solid ${disabled?D.border:D.amber+"44"}`},
    s4:     {background:disabled?D.surf2:`${D.indigo}1a`,color:disabled?D.textMuted:D.sky,border:`1px solid ${disabled?D.border:D.indigo+"44"}`},
    s6:     {background:disabled?D.surf2:`${D.amber}1a`,color:disabled?D.textMuted:D.amber,border:`1px solid ${disabled?D.border:D.amber+"44"}`},
    wkt:    {background:disabled?D.surf2:`${D.rose}14`,color:disabled?D.textMuted:D.rose,border:`1px solid ${disabled?D.border:D.rose+"44"}`,boxShadow:disabled?"none":`0 4px 24px ${D.rose}28`},
  };
  const v=V[variant]||V.primary;
  return (
    <button className="pressBtn" disabled={!!disabled} onClick={!disabled?onClick:undefined} style={{
      ...v, padding:pad, borderRadius:D.pill, cursor:disabled?"not-allowed":"pointer",
      fontFamily:D.body, fontSize:fs, fontWeight:600, letterSpacing:"0.01em",
      width:full?"100%":undefined, whiteSpace:"nowrap",
      opacity:disabled?0.42:1, transition:"all .15s", ...sx,
    }}>{children}</button>
  );
};

const SignalBar = ({ label, value, pct, color, center }) => (
  <div>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:"5px"}}>
      <Lbl>{label}</Lbl>
      <span style={{fontFamily:D.mono,fontSize:"11px",color:color||D.textPrimary}}>{value}</span>
    </div>
    <div style={{height:"3px",borderRadius:"2px",background:D.surf3,overflow:"hidden",position:"relative"}}>
      {center
        ? <><div style={{position:"absolute",left:"50%",width:"1px",height:"100%",background:D.border,zIndex:1}}/>
            <div style={{position:"absolute",left:pct>=50?"50%":`${pct}%`,width:`${Math.abs(pct-50)}%`,height:"100%",background:color||D.indigo,transition:"width .8s ease"}}/></>
        : <div style={{height:"100%",width:`${Math.min(100,Math.max(0,pct))}%`,background:color||D.indigo,borderRadius:"2px",transition:"width .8s ease"}}/>
      }
    </div>
  </div>
);

/* ── Bottom Sheet ── */
const Sheet = ({ children, title, accent, onClose }) => (
  <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
    <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(3,5,12,.75)",backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)"}}/>
    <div className="slideUp" style={{position:"relative",background:D.glass,backdropFilter:"blur(28px) saturate(1.8)",
      WebkitBackdropFilter:"blur(28px) saturate(1.8)",border:`1px solid ${D.borderMed}`,
      borderBottom:"none",borderRadius:`${D.xxl} ${D.xxl} 0 0`,
      boxShadow:"0 -32px 80px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.1)",
      maxHeight:"92vh",display:"flex",flexDirection:"column"}}>
      <div style={{display:"flex",justifyContent:"center",paddingTop:"12px",paddingBottom:"4px",flexShrink:0}}>
        <div style={{width:"36px",height:"4px",borderRadius:"2px",background:D.borderMed}}/>
      </div>
      {title&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 24px 4px",flexShrink:0}}>
          <div style={{fontFamily:D.head,fontSize:"18px",fontWeight:700,color:accent||D.textPrimary}}>{title}</div>
          <button onClick={onClose} style={{background:"transparent",border:"none",color:D.textMuted,fontSize:"22px",cursor:"pointer",lineHeight:1,padding:"4px 6px"}}>&times;</button>
        </div>
      )}
      <div style={{overflow:"auto",padding:"0 24px 32px"}}>{children}</div>
    </div>
  </div>
);

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

/* ═══════════════════════════════════════════════════════
   DYNAMIC CONTENT BAR (DCB) — persistent smart strip
═══════════════════════════════════════════════════════ */
function DynamicBar({inn,match,target,isChase,lastOver}){
  const[cardIdx,setCardIdx]=useState(0);
  const[prevCard,setPrevCard]=useState(null);
  const[animKey,setAnimKey]=useState(0);
  const timerRef=useRef(null);
  const sig=buildSignals(inn,match?.overs||20,target,isChase);
  const cards=buildNarratives(sig,lastOver);

  useEffect(()=>{
    if(cards.length===0)return;
    clearInterval(timerRef.current);
    timerRef.current=setInterval(()=>{
      setCardIdx(p=>{const next=(p+1)%cards.length;return next;});
      setAnimKey(k=>k+1);
    },7000);
    return()=>clearInterval(timerRef.current);
  },[cards.length,sig?.balls]);

  // Snap to top card when a new high-priority event arrives.
  // Compare by content key — cards are rebuilt fresh every render, so
  // identity comparison re-fires setPrevCard each render (infinite loop
  // whenever the innings has any balls, e.g. a resumed live match).
  const topCard=cards[0];
  const topKey=topCard?`${topCard.type}|${topCard.hl}`:null;
  useEffect(()=>{
    if(topKey&&topKey!==prevCard){
      if(topCard.pri>=70){setCardIdx(0);setAnimKey(k=>k+1);}
      setPrevCard(topKey);
    }
  },[topKey]);

  if(!sig||!inn)return null;
  const card=cards[Math.min(cardIdx,cards.length-1)]||cards[0];
  if(!card)return null;

  // RR section — always visible on left
  const rrCol=isChase?(sig.rrDelta!=null&&sig.rrDelta<-1?D.rose:D.emerald):D.sky;
  const rrrDelta=sig.rrDelta!=null?sig.rrDelta:null;
  const phaseCol=sig.phase==="POWERPLAY"?D.emerald:sig.phase==="MIDDLE"?D.amber:D.orange;

  return (
    <div style={{
      position:"sticky",top:"45px",zIndex:95,
      background:`linear-gradient(180deg,${D.base}f8 0%,${D.base}e0 100%)`,
      backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",
      borderBottom:`1px solid ${D.border}`,
    }}>
      <div style={{maxWidth:"1320px",margin:"0 auto",
        display:"grid",gridTemplateColumns:"auto 1fr auto",
        alignItems:"stretch",gap:0,minHeight:"52px"}}>

        {/* LEFT — RR always visible */}
        <div style={{
          display:"flex",alignItems:"center",gap:0,
          borderRight:`1px solid ${D.border}`,
          padding:"0 16px",flexShrink:0,
        }}>
          {/* CRR */}
          <div style={{textAlign:"center",padding:"0 10px",borderRight:`1px solid ${D.border}66`}}>
            <div style={{fontFamily:D.mono,fontSize:"21px",fontWeight:500,color:rrCol,lineHeight:1,letterSpacing:"-0.02em"}}>{sig.rr}</div>
            <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginTop:"2px"}}>CRR</div>
          </div>
          {/* RRR if chasing */}
          {isChase&&sig.reqRr!=null&&(
            <div style={{textAlign:"center",padding:"0 10px",borderRight:`1px solid ${D.border}66`}}>
              <div style={{fontFamily:D.mono,fontSize:"21px",fontWeight:500,color:sig.rrDelta<-1?D.rose:sig.rrDelta>0.5?D.emerald:D.amber,lineHeight:1,letterSpacing:"-0.02em"}}>{sig.reqRr}</div>
              <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted,marginTop:"2px"}}>RRR</div>
            </div>
          )}
          {/* Phase badge */}
          <div style={{padding:"0 10px",display:"flex",flexDirection:"column",alignItems:"center",gap:"3px"}}>
            <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:phaseCol,letterSpacing:"0.08em",textTransform:"uppercase",
              padding:"2px 8px",borderRadius:D.pill,border:`1px solid ${phaseCol}33`,background:phaseCol+"10"}}>{sig.phase}</div>
            <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{fmtOv(sig.balls)} ov</div>
          </div>
        </div>

        {/* CENTRE — rotating narrative card */}
        <div key={animKey} style={{
          display:"flex",alignItems:"center",gap:"12px",
          padding:"8px 16px",overflow:"hidden",
          animation:"fadeIn .4s ease both",
        }}>
          {card.icon&&<span style={{fontSize:"16px",flexShrink:0}}>{card.icon}</span>}
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:card.accent,
              whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",lineHeight:1.2}}>{card.hl}</div>
            <div style={{display:"flex",gap:"8px",marginTop:"5px",flexWrap:"nowrap",overflow:"hidden"}}>
              {card.chips.slice(0,3).map((chip,i)=>(
                <div key={i} style={{display:"flex",alignItems:"baseline",gap:"3px",flexShrink:0}}>
                  <span style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:chip.c||D.textPrimary,lineHeight:1}}>{chip.v}</span>
                  <span style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:D.textMuted}}>{chip.l}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — pressure + momentum micro-bars + dot nav */}
        <div style={{
          display:"flex",alignItems:"center",gap:"8px",
          borderLeft:`1px solid ${D.border}`,padding:"0 12px",flexShrink:0,
        }}>
          {/* Momentum indicator */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",width:"38px"}}>
            <div style={{width:"100%",height:"4px",background:D.surf3,borderRadius:"4px",overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:"4px",
                width:Math.min(100,Math.max(0,50+sig.mom/2))+"%",
                background:sig.momColor,transition:"width .5s ease"}}/>
            </div>
            <span style={{fontFamily:D.head,fontSize:"7.5px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:sig.momColor}}>{sig.momLabel}</span>
          </div>
          {/* Pressure indicator */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",width:"38px"}}>
            <div style={{width:"100%",height:"4px",background:D.surf3,borderRadius:"4px",overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:"4px",
                width:sig.pressure+"%",
                background:sig.pressureColor,transition:"width .5s ease"}}/>
            </div>
            <span style={{fontFamily:D.head,fontSize:"7.5px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:sig.pressureColor}}>{sig.pressureLabel}</span>
          </div>
          {/* Card nav dots */}
          {cards.length>1&&(
            <div style={{display:"flex",flexDirection:"column",gap:"3px"}}>
              {cards.slice(0,5).map((_,i)=>(
                <button key={i} onClick={()=>{setCardIdx(i);setAnimKey(k=>k+1);}}
                  style={{width:i===cardIdx?"14px":"5px",height:"5px",borderRadius:"4px",border:"none",padding:0,cursor:"pointer",
                    background:i===cardIdx?(cards[i]?.accent||D.indigo):`${D.textMuted}30`,transition:"all .25s"}}>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Accent line — colour from top card */}
      <div style={{height:"1.5px",background:`linear-gradient(90deg,${card.accent},${card.accent}55,transparent)`,transition:"background .5s"}}/>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   WAGON WHEEL
═══════════════════════════════════════════════════════ */
function WagonWheel({ballLog=[],selSeg,onSel,viewMode,onViewMode,hidden,onToggle}){
  const[hov,setHov]=useState(null);
  const segRuns=Array(12).fill(0);
  ballLog.forEach(b=>{if(b.seg!=null)segRuns[b.seg]+=(b.value||0);});
  const maxR=Math.max(...segRuns,1);
  const isSel=id=>selSeg?.seg===id;
  const zoneFill=(id,zone)=>{
    const sel=isSel(id),hv=hov?.seg===id;
    if(viewMode==="heatmap")return heatColor(segRuns[id],maxR)||"transparent";
    if(sel&&selSeg.zone===zone)return"rgba(79,70,229,.38)";
    if(sel)return"rgba(79,70,229,.14)";
    if(hv)return"rgba(14,165,233,.12)";
    return"transparent";
  };
  const visLines=ballLog.filter(b=>b.seg!=null&&!hidden.has(lineKey(b)));
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"11px"}}>
      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
        <Lbl>Field Map</Lbl>
        <div style={{marginLeft:"auto",display:"flex",gap:"2px",background:D.surf3,borderRadius:D.pill,padding:"3px"}}>
          {["wagon","heatmap"].map(m=>(
            <button key={m} onClick={()=>onViewMode(m)} className="pressBtn" style={{
              padding:"4px 13px",borderRadius:D.pill,border:"none",cursor:"pointer",
              background:viewMode===m?D.grad:"transparent",
              color:viewMode===m?"#fff":D.textMuted,
              fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.06em",
              textTransform:"uppercase",transition:"all .25s",
            }}>{m==="wagon"?"Wheel":"Heat"}</button>
          ))}
        </div>
      </div>
      <div style={{width:"100%",maxWidth:"272px",margin:"0 auto",aspectRatio:"1",userSelect:"none"}}>
        <svg viewBox="0 0 300 300" style={{width:"100%",height:"100%",display:"block"}}>
          <defs>
            <radialGradient id="gOuter" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0e1a10"/><stop offset="100%" stopColor="#060c08"/>
            </radialGradient>
            <radialGradient id="gInner" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0c1610"/><stop offset="100%" stopColor="#050a07"/>
            </radialGradient>
            <filter id="glow"><feGaussianBlur stdDeviation="2.5" result="blur"/>
              <feComposite in="SourceGraphic" in2="blur" operator="over"/></filter>
          </defs>
          <circle cx={CX} cy={CY} r={R_BND+3} fill="url(#gOuter)"/>
          {SEGS.map(seg=>{
            const sel=isSel(seg.id),hv=hov?.seg===seg.id;
            const fill=viewMode==="heatmap"?(heatColor(segRuns[seg.id],maxR)||`${D.amber}0d`):sel?`rgba(79,70,229,.42)`:hv?`rgba(14,165,233,.16)`:`${D.amber}0c`;
            const stroke=sel?`rgba(79,70,229,.7)`:hv?`rgba(14,165,233,.4)`:`${D.amber}25`;
            return(<path key={`b${seg.id}`} d={ringArc(seg.angle,R_BND,R_MID)} fill={fill} stroke={stroke}
              strokeWidth={sel?"1.5":"0.5"} style={{cursor:"pointer"}}
              onClick={()=>onSel(sel&&selSeg?.zone==="boundary"?null:{seg:seg.id,zone:"boundary"})}
              onMouseEnter={()=>setHov({seg:seg.id})} onMouseLeave={()=>setHov(null)}/>);
          })}
          <circle cx={CX} cy={CY} r={R_MID} fill="none" stroke={`${D.amber}50`} strokeWidth="1.5" strokeDasharray="4 3"/>
          {SEGS.map(seg=>(
            <path key={`o${seg.id}`} d={ringArc(seg.angle,R_MID,R_IN)} fill={zoneFill(seg.id,"outer")}
              stroke={isSel(seg.id)?"rgba(79,70,229,.35)":"rgba(255,255,255,.04)"} strokeWidth="0.4" style={{cursor:"pointer"}}
              onClick={()=>onSel(isSel(seg.id)&&selSeg?.zone==="outer"?null:{seg:seg.id,zone:"outer"})}
              onMouseEnter={()=>setHov({seg:seg.id})} onMouseLeave={()=>setHov(null)}/>
          ))}
          <circle cx={CX} cy={CY} r={R_IN} fill="url(#gInner)" stroke="rgba(255,255,255,.1)" strokeWidth="1" strokeDasharray="3 4"/>
          {SEGS.map(seg=>(
            <path key={`i${seg.id}`} d={pieSlice(seg.angle,R_IN)} fill={zoneFill(seg.id,"inner")}
              stroke={isSel(seg.id)?"rgba(79,70,229,.25)":"rgba(255,255,255,.03)"} strokeWidth="0.4" style={{cursor:"pointer"}}
              onClick={()=>onSel(isSel(seg.id)&&selSeg?.zone==="inner"?null:{seg:seg.id,zone:"inner"})}
              onMouseEnter={()=>setHov({seg:seg.id})} onMouseLeave={()=>setHov(null)}/>
          ))}
          {SEGS.map(seg=>{const[xo,yo]=toXY(seg.angle-15,R_BND);return(
            <line key={`sp${seg.id}`} x1={CX} y1={CY} x2={xo} y2={yo} stroke="rgba(255,255,255,.05)" strokeWidth="0.5" style={{pointerEvents:"none"}}/>
          );})}
          {viewMode==="wagon"&&visLines.map((b,i)=>{
            const[ex,ey]=wagEnd(SEGS[b.seg].angle,b);
            const col=LK_COLS[lineKey(b)];
            const w=b.value===6?2.5:b.value===4?2:1.2;
            return(<line key={`wl${i}`} x1={CX} y1={CY} x2={ex} y2={ey} stroke={col} strokeWidth={w}
              opacity={b.value===0?0.25:0.72} strokeLinecap="round" className="wagonLine" style={{animationDelay:`${i*.02}s`}}/>);
          })}
          {viewMode==="wagon"&&visLines.filter(b=>b.value>=4).map((b,i)=>{
            const[ex,ey]=wagEnd(SEGS[b.seg].angle,b);
            const col=LK_COLS[lineKey(b)];
            return(<circle key={`dt${i}`} cx={ex} cy={ey} r={b.value===6?5.5:4} fill={col} opacity="0.95"
              style={{pointerEvents:"none",filter:b.value===6?"url(#glow)":"none"}}/>);
          })}
          <rect x={CX-4.5} y={CY-R_PITCH} width={9} height={R_PITCH*2} rx="2.5" fill="#7c6e45" stroke={`${D.amber}60`} strokeWidth="0.7" style={{pointerEvents:"none"}}/>
          <line x1={CX-6} y1={CY-R_PITCH+3} x2={CX+6} y2={CY-R_PITCH+3} stroke="rgba(255,255,255,.55)" strokeWidth="0.8" style={{pointerEvents:"none"}}/>
          <line x1={CX-6} y1={CY+R_PITCH-3} x2={CX+6} y2={CY+R_PITCH-3} stroke="rgba(255,255,255,.55)" strokeWidth="0.8" style={{pointerEvents:"none"}}/>
          {[-2.8,0,2.8].map(x=>[
            <circle key={`st${x}`} cx={CX+x} cy={CY-R_PITCH+1.5} r="1.4" fill="rgba(255,255,255,.8)" style={{pointerEvents:"none"}}/>,
            <circle key={`sb${x}`} cx={CX+x} cy={CY+R_PITCH-1.5} r="1.4" fill="rgba(255,255,255,.8)" style={{pointerEvents:"none"}}/>
          ])}
          {SEGS.map(seg=>{
            const[lx,ly]=toXY(seg.angle,(R_IN+R_MID)/2+4);
            const sel=isSel(seg.id),hv=hov?.seg===seg.id;
            return(<text key={`lb${seg.id}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fontSize={sel||hv?"8":"7.5"} fontFamily="'Syne',sans-serif" fontWeight={sel||hv?"700":"400"}
              fill={sel?"#818cf8":hv?"#7dd3fc":"rgba(255,255,255,.32)"} style={{pointerEvents:"none"}}>{seg.short}</text>);
          })}
          {viewMode==="heatmap"&&SEGS.map(seg=>{
            if(!segRuns[seg.id])return null;
            const[lx,ly]=toXY(seg.angle,(R_IN+R_MID)/2+12);
            return(<text key={`hr${seg.id}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fontSize="8" fontFamily="'DM Mono',monospace" fontWeight="500"
              fill="rgba(255,255,255,.65)" style={{pointerEvents:"none"}}>{segRuns[seg.id]}</text>);
          })}
          <text x={9} y={CY} textAnchor="middle" dominantBaseline="middle" fontSize="6"
            fontFamily="'Syne',sans-serif" letterSpacing="1" fill="rgba(255,255,255,.18)"
            transform={`rotate(-90,9,${CY})`} style={{pointerEvents:"none"}}>OFF</text>
          <text x={291} y={CY} textAnchor="middle" dominantBaseline="middle" fontSize="6"
            fontFamily="'Syne',sans-serif" letterSpacing="1" fill="rgba(255,255,255,.18)"
            transform={`rotate(90,291,${CY})`} style={{pointerEvents:"none"}}>LEG</text>
        </svg>
      </div>
      <div style={{display:"flex",justifyContent:"center",gap:"5px",flexWrap:"wrap"}}>
        {Object.entries(LK_COLS).map(([k,col])=>{
          const off=hidden.has(k);
          return(<button key={k} onClick={()=>onToggle(k)} className="pressBtn" style={{
            display:"flex",alignItems:"center",gap:"5px",padding:"4px 10px",borderRadius:D.pill,
            cursor:"pointer",background:off?"transparent":`${col}12`,
            border:`1px solid ${off?D.border:`${col}38`}`,opacity:off?0.3:1,transition:"all .2s",
          }}>
            <div style={{width:"12px",height:"2px",borderRadius:"2px",background:off?D.textMuted:col}}/>
            <span style={{color:off?D.textMuted:D.textSecondary,fontSize:"10px",fontFamily:D.head,fontWeight:600,letterSpacing:"0.05em"}}>{k}</span>
          </button>);
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   INTEL PANEL
═══════════════════════════════════════════════════════ */
function IntelPanel({inn,overs,target,isChase}){
  const[idx,setIdx]=useState(0);
  const[auto,setAuto]=useState(true);const[lastOver,setLastOver]=useState(null);
  const timer=useRef(null);
  useEffect(()=>{
    if(!inn)return;
    const comp=inn.overLog.filter(o=>o.balls.length===6);
    if(comp.length>0){const lat=comp[comp.length-1];if(lat!==lastOver)setLastOver(lat);}
  },[inn?.overLog]);
  const sig=buildSignals(inn,overs,target,isChase);
  const cards=buildNarratives(sig,lastOver);
  useEffect(()=>{
    if(!auto||cards.length===0){clearInterval(timer.current);return;}
    timer.current=setInterval(()=>setIdx(p=>(p+1)%Math.max(1,cards.length)),6200);
    return()=>clearInterval(timer.current);
  },[auto,cards.length]);
  useEffect(()=>setIdx(0),[cards.length]);
  const phaseCol=sig?.phase==="POWERPLAY"?D.emerald:sig?.phase==="MIDDLE"?D.amber:D.orange;
  if(!sig||cards.length===0)return(
    <Card style={{padding:"18px 20px"}}>
      <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"10px"}}>
        <div style={{width:"8px",height:"8px",borderRadius:"50%",background:D.indigo}}/>
        <Lbl>Match Intelligence</Lbl>
      </div>
      <div style={{color:D.textMuted,fontSize:"13px",fontFamily:D.body,lineHeight:1.5}}>Intelligence builds as the match develops…</div>
    </Card>
  );
  const card=cards[Math.min(idx,cards.length-1)];
  return (
    <div style={{borderRadius:D.lg,overflow:"hidden",position:"relative",
      background:`linear-gradient(145deg,${D.surf1},${D.surf2})`,
      border:`1px solid ${card.accent}30`,
      boxShadow:`0 8px 40px rgba(0,0,0,.4),0 0 60px ${card.accent}08`,
      transition:"border-color .5s,box-shadow .5s"}}>
      <div style={{height:"2px",background:`linear-gradient(90deg,${card.accent},${card.accent}00)`}}/>
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:"6px",flex:1,flexWrap:"wrap"}}>
          <Lbl>Intelligence</Lbl>
          <Badge color={phaseCol}>{sig.phase}</Badge>
          <Badge color={sig.pressureColor}>{sig.pressureLabel}</Badge>
          <Badge color={sig.momColor}>{sig.momLabel}</Badge>
        </div>
        <div style={{display:"flex",gap:"3px",alignItems:"center"}}>
          <button onClick={()=>setAuto(p=>!p)} className="pressBtn" style={{
            padding:"3px 8px",borderRadius:D.pill,cursor:"pointer",fontFamily:D.head,fontSize:"9px",
            border:`1px solid ${auto?D.emerald+"44":D.border}`,background:"transparent",
            color:auto?D.emerald:D.textMuted,transition:"all .2s",
          }}>{auto?"⏸":"▶"}</button>
        </div>
      </div>
      <div style={{padding:"16px 18px",position:"relative"}}>
        <div style={{position:"absolute",top:-10,right:-10,width:"90px",height:"90px",borderRadius:"50%",
          background:`${card.accent}14`,filter:"blur(28px)",pointerEvents:"none"}}/>
        <div style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:card.accent,marginBottom:"13px",lineHeight:1.3,position:"relative"}}>{card.hl}</div>
        <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"16px"}}>
          {card.chips.map((chip,i)=>(
            <div key={i} style={{background:D.surf0,border:`1px solid ${chip.c?`${chip.c}28`:D.border}`,
              borderRadius:D.md,padding:"9px 14px",display:"flex",flexDirection:"column",alignItems:"center",minWidth:"58px",gap:"3px"}}>
              <span style={{fontFamily:D.mono,fontSize:"19px",fontWeight:500,color:chip.c||D.textPrimary,lineHeight:1,letterSpacing:"-0.01em"}}>{chip.v}</span>
              <span style={{fontFamily:D.head,fontSize:"8.5px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted}}>{chip.l}</span>
            </div>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"10px",borderTop:`1px solid ${D.border}`,paddingTop:"13px"}}>
          <SignalBar label="Pressure" value={`${sig.pressure}%`} pct={sig.pressure} color={sig.pressureColor}/>
          <SignalBar label="Momentum" value={sig.momLabel} pct={50+sig.mom/2} color={sig.momColor} center/>
          <SignalBar label={sig.reqRr?"Req RR":"Run Rate"} value={sig.reqRr??sig.rr} pct={Math.min(100,(sig.reqRr||sig.rr)/18*100)} color={sig.reqRr&&sig.rrDelta<-1?D.rose:D.sky}/>
        </div>
      </div>
      <div style={{padding:"8px 16px",borderTop:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"8px",background:`${D.surf0}55`}}>
        <div style={{display:"flex",gap:"4px",flex:1,flexWrap:"wrap"}}>
          {cards.map((c,i)=>(
            <button key={i} onClick={()=>{setIdx(i);setAuto(false);}} style={{
              width:i===idx?"18px":"6px",height:"6px",borderRadius:"4px",border:"none",cursor:"pointer",padding:0,
              background:i===idx?card.accent:`${D.textMuted}30`,transition:"all .3s ease",
            }}/>
          ))}
        </div>
        <span style={{color:D.textMuted,fontSize:"9px",fontFamily:D.mono,flexShrink:0}}>{idx+1}/{cards.length}</span>
        {sig.flags.slice(0,2).map(f=>(
          <Badge key={f} color={D.orange} sx={{fontSize:"7.5px",padding:"2px 6px"}}>{f.replace(/_/g," ")}</Badge>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SCORECARD
═══════════════════════════════════════════════════════ */
const SR=(r,b)=>b===0?"—":((r/b)*100).toFixed(1);
const RR=(r,b)=>b===0?"—":((r/(b/6))||0).toFixed(2);
const fmtOv=b=>`${Math.floor(b/6)}.${b%6}`;

function ScorecardPanel({innings,idx}){
  const i=innings[idx];if(!i)return null;
  const batted=i.batsmen.filter(b=>b.balls>0||b.status==="batting"||b.status==="dnb");
  const bowled=i.bowlers.filter(b=>b.balls>0);
  const xtra=i.extras.wide+i.extras.noBall+i.extras.bye+i.extras.legBye+i.extras.penalty;
  const thRow=(cols,colDefs)=>(
    <div style={{padding:"9px 14px 6px",display:"grid",gridTemplateColumns:colDefs,gap:"4px",borderBottom:`1px solid ${D.border}`}}>
      {cols.map(h=><Lbl key={h} sx={{textAlign:h===cols[0]?"left":"right"}}>{h}</Lbl>)}
    </div>
  );
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
      <div style={{background:`linear-gradient(135deg,${D.surf1},${D.surf2})`,borderRadius:D.lg,padding:"16px 18px",border:`1px solid ${D.border}`}}>
        <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textMuted,marginBottom:"3px"}}>{i.battingTeam} · Innings {idx+1}</div>
        <div style={{fontFamily:D.mono,fontSize:"38px",fontWeight:500,color:D.textPrimary,lineHeight:1,letterSpacing:"-0.02em"}}>
          {i.runs}<span style={{color:D.textMuted,fontSize:"26px",fontWeight:400}}>/{i.wickets}</span>
        </div>
        <div style={{color:D.textMuted,fontSize:"12px",fontFamily:D.body,marginTop:"4px"}}>{fmtOv(i.balls)} overs · RR {RR(i.runs,i.balls)}</div>
      </div>
      {/* Batting */}
      <Card>
        {thRow(["Batsman","R","B","4s","6s","SR"],"1fr 30px 30px 26px 26px 42px")}
        {batted.map((b,ii)=>(
          <div key={b.id} style={{padding:"8px 14px",display:"grid",gridTemplateColumns:"1fr 30px 30px 26px 26px 42px",gap:"4px",
            background:ii%2?`${D.surf2}60`:"transparent",borderBottom:`1px solid ${D.border}`,alignItems:"start"}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
                {b.status==="batting"&&<div className="liveDot" style={{width:"5px",height:"5px",borderRadius:"50%",background:D.emerald,flexShrink:0}}/>}
                <span style={{color:D.textPrimary,fontSize:"13px",fontFamily:D.body,fontWeight:500}}>{b.name}</span>
                {b.status==="dnb"&&<span style={{color:D.textMuted,fontSize:"10px",fontFamily:D.body}}>(dnb)</span>}
              </div>
              {b.dismissal&&<div style={{color:D.textMuted,fontSize:"10px",marginTop:"2px",fontFamily:D.body,fontStyle:"italic"}}>{b.dismissal}</div>}
            </div>
            {[b.runs,b.balls,b.fours,b.sixes,SR(b.runs,b.balls)].map((v,j)=>(
              <div key={j} style={{textAlign:"right",fontFamily:D.mono,fontSize:"12px",fontWeight:j===0?"500":"400",
                color:j===2?D.indigo:j===3?D.amber:j===4?D.textMuted:D.textPrimary}}>{v}</div>
            ))}
          </div>
        ))}
        <div style={{padding:"7px 14px",display:"flex",justifyContent:"space-between"}}>
          <span style={{color:D.textMuted,fontSize:"10px",fontFamily:D.body}}>
            Extras: Wd {i.extras.wide} · NB {i.extras.noBall} · B {i.extras.bye} · LB {i.extras.legBye}{i.extras.penalty>0?` · Pen ${i.extras.penalty}`:""}
          </span>
          <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textSecondary}}>{xtra}</span>
        </div>
      </Card>
      {/* Fall of Wickets */}
      {i.fow.length>0&&(
        <Card style={{padding:"12px 14px"}}>
          <Lbl sx={{marginBottom:"8px"}}>Fall of Wickets</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
            {i.fow.map((f,ii)=>(
              <div key={ii} style={{background:`${D.rose}10`,border:`1px solid ${D.rose}28`,borderRadius:D.sm,padding:"4px 10px"}}>
                <span style={{color:D.rose,fontFamily:D.mono,fontSize:"12px",fontWeight:500}}>{f.runs}/{f.wickets}</span>
                <span style={{color:D.textMuted,fontSize:"10px",fontFamily:D.body,marginLeft:"5px"}}>{f.batsman} ({f.overs})</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      {/* Bowling */}
      <Card>
        {thRow(["Bowler","O","M","R","W","Econ"],"1fr 38px 24px 32px 26px 42px")}
        {bowled.map((b,ii)=>(
          <div key={b.id} style={{padding:"8px 14px",display:"grid",gridTemplateColumns:"1fr 38px 24px 32px 26px 42px",gap:"4px",
            background:ii%2?`${D.surf2}60`:"transparent",borderBottom:`1px solid ${D.border}`,alignItems:"center"}}>
            <span style={{color:D.textPrimary,fontSize:"13px",fontFamily:D.body,fontWeight:500}}>{b.name}</span>
            {[fmtOv(b.balls),b.maidens,b.runs,b.wickets,RR(b.runs,b.balls)].map((v,j)=>(
              <div key={j} style={{textAlign:"right",fontFamily:D.mono,fontSize:"12px",
                fontWeight:j===3?"500":"400",color:j===3?D.rose:D.textPrimary}}>{v}</div>
            ))}
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   OPENING SETUP STEP  (step 4 of SetupScreen)
   Batting order → select 2 openers → select opening bowler
═══════════════════════════════════════════════════════ */
function OpeningSetupStep({batKey,bowlKey,batOrder,setBatOrder,bowlingSquad,bowlingTeamKey,onConfirm}){
  const[subStep,setSubStep]=useState(0); // 0=bat order, 1=openers, 2=bowler
  const[dragging,setDragging]=useState(null);const[dragOver,setDragOver]=useState(null);
  const[opener1,setOpener1]=useState(null);
  const[opener2,setOpener2]=useState(null);
  const[bowler,setBowler]=useState(null);
  const[bowlerFilter,setBowlerFilter]=useState("");
  const batTeam=INT_TEAMS[batKey];
  const bowlTeam=INT_TEAMS[bowlKey];
  const getPlayer=(name)=>batTeam?.players.find(p=>p.name===name)||null;
  const getBowler=(name)=>bowlTeam?.players.find(p=>p.name===name)||null;

  // Drag handlers for batting order
  const onDragStart=(i)=>setDragging(i);
  const onDragEnter=(i)=>setDragOver(i);
  const onDragEnd=()=>{
    if(dragging==null||dragOver==null||dragging===dragOver){setDragging(null);setDragOver(null);return;}
    const next=[...batOrder];const[moved]=next.splice(dragging,1);next.splice(dragOver,0,moved);
    setBatOrder(next);setDragging(null);setDragOver(null);
  };

  const bowlerCandidates=(bowlingSquad||[]).filter(n=>{
    const p=getBowler(n);
    if(!p)return true; // custom player — include
    return p.bowl!==false; // only bowlers
  }).filter(n=>!bowlerFilter||n.toLowerCase().includes(bowlerFilter.toLowerCase()));

  const SUBSTEP_LABELS=["Batting Order","Openers","Opening Bowler"];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      {/* Sub-step tabs */}
      <div style={{display:"flex",gap:"4px"}}>
        {SUBSTEP_LABELS.map((l,i)=>(
          <div key={i} style={{flex:1,textAlign:"center",padding:"7px 4px",borderRadius:D.md,cursor:i<subStep?"pointer":"default",
            background:i===subStep?D.indigo+"20":i<subStep?D.emerald+"10":"transparent",
            border:`1px solid ${i===subStep?D.indigo+"55":i<subStep?D.emerald+"33":D.border}`,
            fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",
            color:i===subStep?D.sky:i<subStep?D.emerald:D.textMuted,transition:"all .2s",
          }} onClick={()=>i<subStep&&setSubStep(i)}>
            {i<subStep?"✓ ":""}{l}
          </div>
        ))}
      </div>

      {/* Sub-step 0: Batting order */}
      {subStep===0&&(
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
            <span style={{fontSize:"20px"}}>{batTeam?.flag}</span>
            <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>{batKey}</div>
            <Lbl sx={{color:D.amber}}>Batting First</Lbl>
          </div>
          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>
            Drag to set your batting order. Openers (1 & 2) are highlighted.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"3px"}}>
            {batOrder.map((name,i)=>{
              const p=getPlayer(name);
              const rc=p?ROLE_COLORS[p.role]||D.textMuted:D.textMuted;
              const isDraggingThis=dragging===i;
              const isDragTarget=dragOver===i&&dragging!==i;
              const isOpener=i<2;
              return (
                <div key={name} draggable onDragStart={()=>onDragStart(i)}
                  onDragEnter={()=>onDragEnter(i)} onDragOver={e=>e.preventDefault()} onDragEnd={onDragEnd}
                  style={{display:"flex",alignItems:"center",gap:"9px",padding:"9px 11px",borderRadius:D.md,
                    background:isDraggingThis?`${D.sky}18`:isDragTarget?`${D.indigo}14`:isOpener?`${D.emerald}09`:D.surf2,
                    border:`1px solid ${isDraggingThis?D.sky+"66":isDragTarget?D.indigo+"44":isOpener?D.emerald+"33":D.border}`,
                    cursor:"grab",userSelect:"none",
                    opacity:isDraggingThis?0.6:1,transition:"all .12s",
                    boxShadow:isDragTarget?`0 0 0 2px ${D.indigo}44`:"none",
                  }}>
                  <span style={{color:D.textMuted,fontSize:"14px",cursor:"grab",flexShrink:0}}>⠿</span>
                  <div style={{width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                    fontFamily:D.mono,fontSize:"10px",fontWeight:600,
                    background:isOpener?`${D.emerald}20`:D.surf3,
                    color:isOpener?D.emerald:D.textMuted,
                    border:`1px solid ${isOpener?D.emerald+"44":D.border}`}}>
                    {i+1}
                  </div>
                  <span style={{flex:1,fontFamily:D.body,fontSize:"13px",fontWeight:isOpener?600:400,color:D.textPrimary}}>{name}</span>
                  {p&&(
                    <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
                      {/* Handedness badges */}
                      <span style={{fontFamily:D.mono,fontSize:"9px",fontWeight:700,padding:"1px 5px",borderRadius:D.pill,
                        background:p.batHand==="L"?`${D.amber}15`:`${D.sky}15`,
                        border:`1px solid ${p.batHand==="L"?D.amber+"33":D.sky+"33"}`,
                        color:p.batHand==="L"?D.amber:D.sky}}>{p.batHand}HB</span>
                      <Badge color={rc} sx={{fontSize:"8px"}}>{p.role}</Badge>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <Btn variant="primary" size="lg" full onClick={()=>setSubStep(1)} sx={{borderRadius:D.md}}>
            Confirm Order → Select Openers
          </Btn>
        </div>
      )}

      {/* Sub-step 1: Select 2 openers */}
      {subStep===1&&(
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>
            {!opener1?"Tap to select Striker (facing first ball)":!opener2?"Tap to select Non-Striker":"Both openers set ✓"}
          </div>
          <div style={{display:"flex",gap:"8px",marginBottom:"4px"}}>
            {[{label:"Striker",val:opener1,col:D.emerald},{label:"Non-Striker",val:opener2,col:D.sky}].map(({label,val,col})=>(
              <div key={label} style={{flex:1,padding:"10px",borderRadius:D.md,border:`1px solid ${val?col+"55":D.border}`,
                background:val?`${col}0e`:D.surf2,textAlign:"center"}}>
                <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:val?col:D.textMuted,marginBottom:"4px"}}>{label}</div>
                <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:val?D.textPrimary:D.textMuted}}>{val||"—"}</div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"3px"}}>
            {batOrder.map((name,i)=>{
              const p=getPlayer(name);
              const rc=p?ROLE_COLORS[p.role]||D.textMuted:D.textMuted;
              const isSelected=opener1===name||opener2===name;
              const isO1=opener1===name,isO2=opener2===name;
              return (
                <button key={name} onClick={()=>{
                  if(opener1===name){setOpener1(null);return;}
                  if(opener2===name){setOpener2(null);return;}
                  if(!opener1){setOpener1(name);return;}
                  if(!opener2){setOpener2(name);}
                }} className="pressBtn" style={{
                  display:"flex",alignItems:"center",gap:"9px",padding:"9px 11px",borderRadius:D.md,cursor:"pointer",
                  textAlign:"left",width:"100%",
                  border:`1px solid ${isO1?D.emerald+"55":isO2?D.sky+"55":D.border}`,
                  background:isO1?`${D.emerald}0e`:isO2?`${D.sky}0e`:D.surf2,
                  transition:"all .15s",
                }}>
                  <div style={{width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                    fontFamily:isSelected?"Syne":"DM Mono",fontSize:isSelected?"10px":"10px",fontWeight:700,
                    background:isO1?`${D.emerald}22`:isO2?`${D.sky}22`:D.surf3,
                    color:isO1?D.emerald:isO2?D.sky:D.textMuted,
                    border:`1px solid ${isO1?D.emerald+"55":isO2?D.sky+"55":D.border}`}}>
                    {isO1?"S":isO2?"N":i+1}
                  </div>
                  <span style={{flex:1,fontFamily:D.body,fontSize:"13px",fontWeight:isSelected?600:400,
                    color:isSelected?D.textPrimary:D.textSecondary}}>{name}</span>
                  {p&&(
                    <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
                      <span style={{fontFamily:D.mono,fontSize:"9px",fontWeight:700,padding:"1px 5px",borderRadius:D.pill,
                        background:p.batHand==="L"?`${D.amber}15`:`${D.sky}15`,
                        border:`1px solid ${p.batHand==="L"?D.amber+"33":D.sky+"33"}`,
                        color:p.batHand==="L"?D.amber:D.sky}}>{p.batHand}HB</span>
                      <Badge color={rc} sx={{fontSize:"8px"}}>{p.role}</Badge>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <Btn variant="primary" size="lg" full disabled={!opener1||!opener2}
            onClick={()=>opener1&&opener2&&setSubStep(2)} sx={{borderRadius:D.md}}>
            {opener1&&opener2?"Select Opening Bowler →":"Select both openers first"}
          </Btn>
        </div>
      )}

      {/* Sub-step 2: Opening bowler */}
      {subStep===2&&(
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
            <span style={{fontSize:"20px"}}>{bowlTeam?.flag}</span>
            <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>{bowlKey}</div>
            <Lbl sx={{color:D.rose}}>Opening Bowler</Lbl>
          </div>
          {/* Filter input */}
          <input value={bowlerFilter} onChange={e=>setBowlerFilter(e.target.value)}
            placeholder="Filter bowlers…"
            style={{background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
              color:D.textPrimary,fontSize:"13px",fontFamily:D.body,padding:"8px 12px",outline:"none",width:"100%"}}/>
          <div style={{display:"flex",flexDirection:"column",gap:"3px",maxHeight:"300px",overflowY:"auto"}}>
            {bowlerCandidates.map(name=>{
              const p=getBowler(name);
              const rc=p?ROLE_COLORS[p.role]||D.textMuted:D.textMuted;
              const isSel=bowler===name;
              const styleDesc=p?`${p.bowlArm==="L"?"LA":"RA"}${p.bowlStyle==="F"?"F":p.bowlStyle==="S"?"S":"M"}`:"";
              return (
                <button key={name} onClick={()=>setBowler(name)} className="pressBtn" style={{
                  display:"flex",alignItems:"center",gap:"9px",padding:"9px 11px",borderRadius:D.md,
                  cursor:"pointer",textAlign:"left",width:"100%",
                  border:`1px solid ${isSel?D.rose+"55":D.border}`,
                  background:isSel?`${D.rose}0e`:D.surf2,transition:"all .15s",
                }}>
                  <div style={{width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                    fontFamily:D.mono,fontSize:"10px",fontWeight:700,
                    background:isSel?`${D.rose}22`:D.surf3,
                    color:isSel?D.rose:D.textMuted,
                    border:`1px solid ${isSel?D.rose+"55":D.border}`}}>
                    {isSel?"✓":"B"}
                  </div>
                  <span style={{flex:1,fontFamily:D.body,fontSize:"13px",fontWeight:isSel?600:400,
                    color:isSel?D.textPrimary:D.textSecondary}}>{name}</span>
                  {p&&(
                    <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
                      {styleDesc&&<span style={{fontFamily:D.mono,fontSize:"9px",fontWeight:700,padding:"1px 5px",borderRadius:D.pill,
                        background:`${D.violet}15`,border:`1px solid ${D.violet}33`,color:D.violet}}>{styleDesc}</span>}
                      <Badge color={rc} sx={{fontSize:"8px"}}>{p.role}</Badge>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <Btn variant="primary" size="lg" full disabled={!bowler}
            onClick={()=>bowler&&onConfirm(opener1,opener2,bowler)} sx={{borderRadius:D.md}}>
            {bowler?`Start Match — ${bowler} to bowl →`:"Select opening bowler first"}
          </Btn>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SETUP SCREEN — with full squad entry
═══════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════
   INTERNATIONAL TEAMS DATABASE
═══════════════════════════════════════════════════════ */
const INT_TEAMS = {
  "Australia": {
    flag:"🇦🇺", abbr:"AUS", accent:"#f4c430",
    players:[
      {name:"David Warner",    role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"F"},
      {name:"Usman Khawaja",   role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Marnus Labuschagne",role:"BAT",bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Steve Smith",     role:"BAT",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Travis Head",     role:"BAT",  bat:true,  bowl:true, batHand:"L", bowlArm:"R", bowlStyle:"S"},
      {name:"Mitchell Marsh",  role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Alex Carey",      role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Pat Cummins",     role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mitchell Starc",  role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"F"},
      {name:"Josh Hazlewood",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Adam Zampa",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Cameron Green",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Marcus Stoinis",  role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Matthew Wade",    role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Nathan Lyon",     role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
    ]
  },
  "England": {
    flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿", abbr:"ENG", accent:"#003580",
    players:[
      {name:"Zak Crawley",     role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Ben Duckett",     role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"L", bowlStyle:"M"},
      {name:"Ollie Pope",      role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Joe Root",        role:"BAT",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Harry Brook",     role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Ben Stokes",      role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"R", bowlStyle:"F"},
      {name:"Jonny Bairstow",  role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Chris Woakes",    role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Gus Atkinson",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Stuart Broad",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"James Anderson",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mark Wood",       role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Brydon Carse",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Moeen Ali",       role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"R", bowlStyle:"S"},
      {name:"Jos Buttler",     role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
    ]
  },
  "India": {
    flag:"🇮🇳", abbr:"IND", accent:"#ff9933",
    players:[
      {name:"Rohit Sharma",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Shubman Gill",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Virat Kohli",     role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Shreyas Iyer",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"KL Rahul",        role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Hardik Pandya",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Ravindra Jadeja", role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Jasprit Bumrah",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mohammed Shami",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mohammed Siraj",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Kuldeep Yadav",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"L", bowlStyle:"S"},
      {name:"Rishabh Pant",    role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Axar Patel",      role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Yashasvi Jaiswal",role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"S"},
      {name:"Arshdeep Singh",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "South Africa": {
    flag:"🇿🇦", abbr:"RSA", accent:"#007a4d",
    players:[
      {name:"Reeza Hendricks",  role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Quinton de Kock",  role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Aiden Markram",    role:"BAT",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Rassie van der Dussen",role:"BAT",bat:true,bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"David Miller",     role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Heinrich Klaasen", role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Marco Jansen",     role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"F"},
      {name:"Keshav Maharaj",   role:"ALL",  bat:false, bowl:true, batHand:"R", bowlArm:"L", bowlStyle:"S"},
      {name:"Kagiso Rabada",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Lungi Ngidi",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Tabraiz Shamsi",   role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Anrich Nortje",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Ryan Rickelton",   role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Tony de Zorzi",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Gerald Coetzee",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "New Zealand": {
    flag:"🇳🇿", abbr:"NZL", accent:"#000000",
    players:[
      {name:"Devon Conway",     role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Will Young",       role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Kane Williamson",  role:"BAT",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Daryl Mitchell",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Tom Latham",       role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Glenn Phillips",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Michael Bracewell",role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Mitchell Santner", role:"ALL",  bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Tim Southee",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Trent Boult",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"L", bowlStyle:"F"},
      {name:"Matt Henry",       role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Lockie Ferguson",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Rachin Ravindra",  role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mark Chapman",     role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"S"},
      {name:"Ish Sodhi",        role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
    ]
  },
  "Pakistan": {
    flag:"🇵🇰", abbr:"PAK", accent:"#01411c",
    players:[
      {name:"Mohammad Rizwan",  role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Saim Ayub",        role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Babar Azam",       role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Saud Shakeel",     role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mohammad Haris",   role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Iftikhar Ahmed",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Shadab Khan",      role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Shaheen Afridi",   role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"F"},
      {name:"Naseem Shah",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Haris Rauf",       role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Abrar Ahmed",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Fakhar Zaman",     role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Agha Salman",      role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Usama Mir",        role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Abdullah Shafique",role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "West Indies": {
    flag:"🏏", abbr:"WI", accent:"#7b0c0c",
    players:[
      {name:"Brandon King",     role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Kyle Mayers",      role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"R", bowlStyle:"F"},
      {name:"Shai Hope",        role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Nicholas Pooran",  role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Shimron Hetmyer",  role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Rovman Powell",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Jason Holder",     role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Gudakesh Motie",   role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Alzarri Joseph",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Shamar Joseph",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Akeal Hosein",     role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Yannic Cariah",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Johnson Charles",  role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Romario Shepherd", role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Kevin Sinclair",   role:"ALL",  bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "Sri Lanka": {
    flag:"🇱🇰", abbr:"SL", accent:"#8b0000",
    players:[
      {name:"Pathum Nissanka",  role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Dimuth Karunaratne",role:"BAT", bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"F"},
      {name:"Kusal Mendis",     role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Angelo Mathews",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Dhananjaya de Silva",role:"ALL",bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Charith Asalanka", role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"S"},
      {name:"Dasun Shanaka",    role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Wanindu Hasaranga",role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Maheesh Theekshana",role:"BOWL",bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Dushmantha Chameera",role:"BOWL",bat:false,bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Kasun Rajitha",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Lahiru Kumara",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Janith Liyanage",  role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Asitha Fernando",  role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Jeffrey Vandersay",role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "Bangladesh": {
    flag:"🇧🇩", abbr:"BAN", accent:"#006a4e",
    players:[
      {name:"Litton Das",       role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Tanzid Hasan",     role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Najmul Hossain",   role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Shakib Al Hasan",  role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Mushfiqur Rahim",  role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Towhid Hridoy",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Mahmudullah",      role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Mehidy Hasan",     role:"ALL",  bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Taskin Ahmed",     role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mustafizur Rahman",role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"F"},
      {name:"Shoriful Islam",   role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"F"},
      {name:"Rishad Hossain",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Nazmul Hossain",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Afif Hossain",     role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Hasan Mahmud",     role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "Afghanistan": {
    flag:"🇦🇫", abbr:"AFG", accent:"#000087",
    players:[
      {name:"Rahmanullah Gurbaz",role:"WK",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Ibrahim Zadran",   role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Rahmat Shah",      role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Hashmatullah Shahidi",role:"BAT",bat:true, bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Mohammad Nabi",    role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Azmatullah Omarzai",role:"ALL", bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Ikram Alikhil",    role:"WK",   bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Rashid Khan",      role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Mujeeb ur Rahman", role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Fazalhaq Farooqi", role:"BOWL", bat:false, bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"F"},
      {name:"Naveen ul Haq",    role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Noor Ahmad",       role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Gulbadin Naib",    role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Karim Janat",      role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Qais Ahmad",       role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
    ]
  },
  "Zimbabwe": {
    flag:"🇿🇼", abbr:"ZIM", accent:"#009a44",
    players:[
      {name:"Craig Ervine",     role:"BAT",  bat:true,  bowl:false, batHand:"L", bowlArm:"R", bowlStyle:"M"},
      {name:"Takudzwanashe Kaitano",role:"BAT",bat:true,bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Sean Williams",    role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"L", bowlStyle:"S"},
      {name:"Sikandar Raza",    role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Regis Chakabva",   role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Milton Shumba",    role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Ryan Burl",        role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Wellington Masakadza",role:"BOWL",bat:false,bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Tendai Chatara",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Blessing Muzarabani",role:"BOWL",bat:false,bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Victor Nyauchi",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Luke Jongwe",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Brian Bennett",    role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Joylord Gumbie",   role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Clive Madande",    role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
    ]
  },
  "Ireland": {
    flag:"🇮🇪", abbr:"IRE", accent:"#169b62",
    players:[
      {name:"Paul Stirling",    role:"BAT",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"S"},
      {name:"Andrew Balbirnie", role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Lorcan Tucker",    role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Harry Tector",     role:"BAT",  bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"George Dockrell",  role:"ALL",  bat:true,  bowl:true, batHand:"L", bowlArm:"R", bowlStyle:"S"},
      {name:"Curtis Campher",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Lorcan Tucker",    role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
      {name:"Andy McBrine",     role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Mark Adair",       role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Barry McCarthy",   role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Josh Little",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"L", bowlStyle:"F"},
      {name:"Craig Young",      role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Fionn Hand",       role:"BOWL", bat:false, bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Trent Johnston",   role:"ALL",  bat:true,  bowl:true, batHand:"R", bowlArm:"R", bowlStyle:"F"},
      {name:"Neil Rock",        role:"WK",   bat:true,  bowl:false, batHand:"R", bowlArm:"R", bowlStyle:"M"},
    ]
  },
};

const ROLE_COLORS = {
  BAT: D.sky, WK: D.emerald, ALL: D.amber, BOWL: D.orange,
};
const ROLE_LABELS = {
  BAT:"Batter", WK:"Wicket-keeper", ALL:"All-rounder", BOWL:"Bowler",
};

/* ═══════════════════════════════════════════════════════
   TEAM SELECTOR COMPONENT (top-level)
═══════════════════════════════════════════════════════ */
function TeamSelector({value, onChange, accent, label}){
  const[open,setOpen]=useState(false);
  const selected=INT_TEAMS[value];
  return (
    <div style={{position:"relative"}}>
      <Lbl sx={{marginBottom:"8px"}}>{label}</Lbl>
      <button onClick={()=>setOpen(p=>!p)} className="pressBtn" style={{
        width:"100%",padding:"12px 16px",borderRadius:D.md,cursor:"pointer",
        background:D.surf2,border:`1px solid ${selected?accent+"55":D.border}`,
        display:"flex",alignItems:"center",gap:"10px",transition:"all .2s",
        boxShadow:selected?`0 0 16px ${accent}10`:"none",
      }}>
        {selected
          ?<><span style={{fontSize:"20px",lineHeight:1}}>{selected.flag}</span>
            <div style={{flex:1,textAlign:"left"}}>
              <div style={{fontFamily:D.body,fontSize:"14px",fontWeight:600,color:D.textPrimary}}>{value}</div>
              <div style={{fontFamily:D.mono,fontSize:"10px",color:accent}}>{selected.abbr}</div>
            </div></>
          :<span style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,flex:1,textAlign:"left"}}>Select team…</span>
        }
        <span style={{color:D.textMuted,fontSize:"12px",transform:open?"rotate(180deg)":"none",transition:"transform .2s"}}>▾</span>
      </button>
      {open&&(
        <div className="fadeIn" style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,zIndex:300,
          background:D.glass,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",
          border:`1px solid ${D.borderMed}`,borderRadius:D.lg,overflow:"hidden",
          boxShadow:"0 24px 60px rgba(0,0,0,.7)"}}>
          <div style={{maxHeight:"260px",overflow:"auto"}}>
            {Object.entries(INT_TEAMS).map(([name,info])=>(
              <button key={name} onClick={()=>{onChange(name);setOpen(false);}} className="pressBtn" style={{
                width:"100%",padding:"10px 14px",background:value===name?`${accent}12`:"transparent",
                border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:"10px",
                borderBottom:`1px solid ${D.border}`,transition:"background .15s",
              }}>
                <span style={{fontSize:"18px",lineHeight:1}}>{info.flag}</span>
                <span style={{fontFamily:D.body,fontSize:"13px",fontWeight:value===name?600:400,
                  color:value===name?D.textPrimary:D.textSecondary,flex:1,textAlign:"left"}}>{name}</span>
                <span style={{fontFamily:D.mono,fontSize:"10px",color:value===name?accent:D.textMuted}}>{info.abbr}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SQUAD BUILDER — 15 players, select 11 + 12th man
═══════════════════════════════════════════════════════ */
function SquadBuilder({teamKey, selected11, setSelected11, twelfthMan, setTwelfthMan, battingOrder, setBattingOrder}){
  const team=INT_TEAMS[teamKey];
  if(!team)return null;
  const accent=team.accent||D.sky;
  const dragIdx=useRef(null);
  const dragOverIdx=useRef(null);
  const[dragging,setDragging]=useState(null);
  const[dragOver,setDragOver]=useState(null);

  const toggle=(playerName)=>{
    const inXI=selected11.includes(playerName);
    const is12th=twelfthMan===playerName;
    if(is12th){setTwelfthMan(null);return;}
    if(inXI){
      setSelected11(selected11.filter(n=>n!==playerName));
      setBattingOrder(battingOrder.filter(n=>n!==playerName));
    } else if(selected11.length<11){
      setSelected11([...selected11,playerName]);
      setBattingOrder([...battingOrder.filter(n=>n!==playerName),playerName]);
    }
  };

  const setAs12th=(playerName,e)=>{
    e.stopPropagation();
    if(selected11.includes(playerName))return;
    setTwelfthMan(p=>p===playerName?null:playerName);
  };

  // Drag handlers for batting order
  const onDragStart=(idx)=>{dragIdx.current=idx;setDragging(idx);};
  const onDragEnter=(idx)=>{dragOverIdx.current=idx;setDragOver(idx);};
  const onDragEnd=()=>{
    const from=dragIdx.current;const to=dragOverIdx.current;
    if(from!==null&&to!==null&&from!==to){
      const newOrder=[...battingOrder];
      const [moved]=newOrder.splice(from,1);
      newOrder.splice(to,0,moved);
      setBattingOrder(newOrder);
    }
    dragIdx.current=null;dragOverIdx.current=null;
    setDragging(null);setDragOver(null);
  };

  const xi=selected11.length;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      <div style={{display:"flex",gap:"8px",alignItems:"center",flexWrap:"wrap"}}>
        <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,
          color:xi===11?D.emerald:xi>11?D.rose:D.amber}}>{xi}/11 selected</div>
        {twelfthMan&&<Badge color={D.violet}>12th: {twelfthMan.split(" ").pop()}</Badge>}
        {xi===11&&!twelfthMan&&<span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>select a 12th man below</span>}
        {xi===11&&twelfthMan&&<Badge color={D.emerald}>Squad complete ✓</Badge>}
        <button onClick={()=>{
          const auto=team.players.slice(0,11).map(p=>p.name);
          setSelected11(auto);setBattingOrder(auto);setTwelfthMan(team.players[11]?.name||null);
        }} className="pressBtn" style={{marginLeft:"auto",padding:"4px 10px",borderRadius:D.pill,
          border:`1px solid ${D.border}`,background:"transparent",cursor:"pointer",
          fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Auto-pick XI</button>
      </div>
      {/* Player list */}
      <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
        {team.players.map((player,i)=>{
          const inXI=selected11.includes(player.name);
          const is12th=twelfthMan===player.name;
          const xiPos=inXI?selected11.indexOf(player.name):-1;
          const rc=ROLE_COLORS[player.role]||D.textMuted;
          return (
            <button key={player.name} onClick={()=>toggle(player.name)} className="pressBtn" style={{
              display:"flex",alignItems:"center",gap:"10px",padding:"9px 12px",
              borderRadius:D.md,cursor:"pointer",textAlign:"left",width:"100%",
              border:`1px solid ${inXI?accent+"44":is12th?D.violet+"44":D.border}`,
              background:inXI?`${accent}0e`:is12th?`${D.violet}0e`:`${D.surf2}88`,
              transition:"all .15s",
              opacity:(!inXI&&!is12th&&xi>=11)?0.4:1,
            }}>
              <div style={{width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,
                background:inXI?`${accent}20`:is12th?`${D.violet}20`:D.surf3,
                border:`1px solid ${inXI?accent+"44":is12th?D.violet+"44":D.border}`,
                display:"flex",alignItems:"center",justifyContent:"center",
                fontFamily:D.mono,fontSize:"10px",fontWeight:600,
                color:inXI?accent:is12th?D.violet:D.textMuted}}>
                {inXI?xiPos+1:is12th?"12":"·"}
              </div>
              <span style={{flex:1,fontFamily:D.body,fontSize:"13px",fontWeight:inXI?600:400,
                color:inXI?D.textPrimary:D.textSecondary}}>{player.name}</span>
              <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                <Badge color={rc} sx={{fontSize:"8px",padding:"2px 6px"}}>{player.role}</Badge>
                {!inXI&&(
                  <button onClick={e=>setAs12th(player.name,e)} className="pressBtn" style={{
                    padding:"3px 8px",borderRadius:D.pill,border:`1px solid ${is12th?D.violet+"55":D.border}`,
                    background:is12th?`${D.violet}18`:"transparent",cursor:"pointer",
                    fontFamily:D.head,fontSize:"8px",fontWeight:700,color:is12th?D.violet:D.textMuted,
                    letterSpacing:"0.06em"}}>12th</button>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {/* Batting order — drag to reorder */}
      {battingOrder.length>0&&(
        <div style={{marginTop:"4px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}}>
            <Lbl sx={{color:accent}}>Batting Order</Lbl>
            <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>≡ drag to reorder</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"3px"}}>
            {battingOrder.map((name,i)=>{
              const isDraggingThis=dragging===i;
              const isDragTarget=dragOver===i&&dragging!==i;
              const ri=team.players.find(p=>p.name===name);
              const rc=ri?ROLE_COLORS[ri.role]||D.textMuted:D.textMuted;
              return (
                <div
                  key={name}
                  draggable
                  onDragStart={()=>onDragStart(i)}
                  onDragEnter={()=>onDragEnter(i)}
                  onDragOver={e=>e.preventDefault()}
                  onDragEnd={onDragEnd}
                  style={{
                    display:"flex",alignItems:"center",gap:"8px",padding:"8px 10px",
                    borderRadius:D.md,
                    background:isDraggingThis?`${accent}18`:isDragTarget?`${accent}12`:D.surf2,
                    border:`1px solid ${isDraggingThis?accent+"66":isDragTarget?accent+"44":D.border}`,
                    cursor:"grab",userSelect:"none",
                    transform:isDraggingThis?"scale(1.02)":"scale(1)",
                    opacity:isDraggingThis?0.7:1,
                    transition:"transform .1s,opacity .1s,border-color .15s,background .15s",
                    boxShadow:isDraggingThis?`0 8px 24px rgba(0,0,0,.4)`:isDragTarget?`0 0 0 2px ${accent}33`:"none",
                  }}>
                  <span style={{color:D.textMuted,fontSize:"14px",lineHeight:1,cursor:"grab",flexShrink:0}}>⠿</span>
                  <div style={{width:"20px",height:"20px",borderRadius:"50%",flexShrink:0,
                    background:i<2?`${D.emerald}18`:i>=8?`${D.orange}18`:`${accent}10`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontFamily:D.mono,fontSize:"10px",color:i<2?D.emerald:i>=8?D.orange:D.textMuted}}>
                    {i+1}
                  </div>
                  <span style={{flex:1,fontFamily:D.body,fontSize:"12px",fontWeight:i<2?600:400,color:D.textPrimary}}>{name}</span>
                  <Badge color={rc} sx={{fontSize:"8px"}}>{ri?.role||"—"}</Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SETUP SCREEN
═══════════════════════════════════════════════════════ */
function SetupScreen({onStart}){
  const[step,setStep]=useState(0);
  const[team1Key,setTeam1Key]=useState("");
  const[team2Key,setTeam2Key]=useState("");
  const[overs,setOvers]=useState(20);
  const[xi1,setXi1]=useState([]);const[order1,setOrder1]=useState([]);const[twelfth1,setTwelfth1]=useState(null);
  const[xi2,setXi2]=useState([]);const[order2,setOrder2]=useState([]);const[twelfth2,setTwelfth2]=useState(null);
  const[toss,setToss]=useState(0);const[bat,setBat]=useState(0);
  const[openBowler,setOpenBowler]=useState("");
  const teams=[team1Key||"Team 1",team2Key||"Team 2"];
  const canContinue0=team1Key&&team2Key&&team1Key!==team2Key;
  const canContinue1=xi1.length===11;
  const canContinue2=xi2.length===11;
  const canStart=toss!==undefined&&bat!==undefined;
  const STEPS=["Match","Team 1","Team 2","Toss","Opening"];
  return (
    <div style={{minHeight:"100vh",background:D.base,display:"flex",flexDirection:"column",alignItems:"center",
      justifyContent:"flex-start",padding:"16px",paddingTop:"40px",overflowY:"auto"}}>
      <GS/>
      <div style={{textAlign:"center",marginBottom:"28px"}}>
        <div style={{fontFamily:D.head,fontSize:"clamp(36px,7vw,60px)",fontWeight:800,letterSpacing:"0.04em",
          background:D.grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          backgroundClip:"text",lineHeight:.95,marginBottom:"8px"}}>SCRBRD</div>
        <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:400,color:D.textMuted,
          letterSpacing:"0.2em",textTransform:"uppercase"}}>Cricket Match Centre</div>
        <div style={{width:"60px",height:"2px",background:D.grad,borderRadius:"2px",margin:"12px auto 0"}}/>
      </div>
      {/* Steps */}
      <div style={{display:"flex",gap:"6px",marginBottom:"20px",flexWrap:"wrap",justifyContent:"center"}}>
        {STEPS.map((s,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:"6px"}}>
            <div style={{
              width:"22px",height:"22px",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
              fontFamily:D.mono,fontSize:"10px",fontWeight:600,cursor:i<step?"pointer":"default",
              background:i===step?D.grad:i<step?`${D.emerald}22`:D.surf2,
              color:i===step?"#fff":i<step?D.emerald:D.textMuted,
              border:`1px solid ${i===step?D.indigo+"66":i<step?D.emerald+"44":D.border}`,
              transition:"all .3s",
            }} onClick={()=>i<step&&setStep(i)}>{i<step?"✓":i+1}</div>
            <span style={{fontFamily:D.body,fontSize:"11px",color:i===step?D.textPrimary:D.textMuted,fontWeight:i===step?600:400}}>{s}</span>
            {i<3&&<div style={{width:"16px",height:"1px",background:D.border}}/>}
          </div>
        ))}
      </div>
      <div style={{width:"100%",maxWidth:"520px"}}>
        <Glass style={{padding:"24px 22px"}}>
          {step===0&&(
            <div style={{display:"flex",flexDirection:"column",gap:"18px"}}>
              <TeamSelector value={team1Key} onChange={setTeam1Key} accent={D.sky} label="Team 1"/>
              <TeamSelector value={team2Key} onChange={v=>{if(v!==team1Key)setTeam2Key(v);}} accent={D.emerald} label="Team 2"/>
              {team1Key&&team2Key&&team1Key===team2Key&&(
                <div style={{color:D.rose,fontSize:"11px",fontFamily:D.body,textAlign:"center"}}>Teams must be different</div>
              )}
              <div>
                <Lbl sx={{marginBottom:"8px"}}>Overs Per Innings</Lbl>
                <div style={{display:"flex",gap:"6px"}}>
                  {[10,20,40,50].map(o=>(
                    <button key={o} onClick={()=>setOvers(o)} className="pressBtn" style={{
                      flex:1,padding:"11px 0",borderRadius:D.md,cursor:"pointer",
                      fontFamily:D.mono,fontSize:"15px",fontWeight:500,
                      border:`1px solid ${overs===o?D.indigo+"77":D.border}`,
                      background:overs===o?`${D.indigo}1a`:D.surf2,
                      color:overs===o?D.sky:D.textMuted,transition:"all .2s",
                    }}>{o}</button>
                  ))}
                </div>
              </div>
              <Btn variant="primary" size="lg" full disabled={!canContinue0}
                onClick={()=>canContinue0&&setStep(1)} sx={{borderRadius:D.md}}>
                Select {INT_TEAMS[team1Key]?.flag} {team1Key||"Team 1"} XI →
              </Btn>
            </div>
          )}
          {step===1&&(
            <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                <span style={{fontSize:"22px"}}>{INT_TEAMS[team1Key]?.flag}</span>
                <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary}}>{team1Key}</div>
                <Badge color={D.sky}>XI + 12th</Badge>
              </div>
              <SquadBuilder
                teamKey={team1Key}
                selected11={xi1} setSelected11={setXi1}
                twelfthMan={twelfth1} setTwelfthMan={setTwelfth1}
                battingOrder={order1} setBattingOrder={setOrder1}/>
              <Btn variant="primary" size="lg" full disabled={!canContinue1}
                onClick={()=>canContinue1&&setStep(2)} sx={{borderRadius:D.md}}>
                {canContinue1?"Select "+INT_TEAMS[team2Key]?.flag+" "+team2Key+" XI →":"Select 11 players first"}
              </Btn>
            </div>
          )}
          {step===2&&(
            <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                <span style={{fontSize:"22px"}}>{INT_TEAMS[team2Key]?.flag}</span>
                <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary}}>{team2Key}</div>
                <Badge color={D.emerald}>XI + 12th</Badge>
              </div>
              <SquadBuilder
                teamKey={team2Key}
                selected11={xi2} setSelected11={setXi2}
                twelfthMan={twelfth2} setTwelfthMan={setTwelfth2}
                battingOrder={order2} setBattingOrder={setOrder2}/>
              <Btn variant="primary" size="lg" full disabled={!canContinue2}
                onClick={()=>canContinue2&&setStep(3)} sx={{borderRadius:D.md}}>
                {canContinue2?"Proceed to Toss →":"Select 11 players first"}
              </Btn>
            </div>
          )}
          {step===3&&(
            <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
              {/* Match summary */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.lg,padding:"14px 16px"}}>
                <div style={{textAlign:"center",flex:1}}>
                  <div style={{fontSize:"24px",marginBottom:"4px"}}>{INT_TEAMS[team1Key]?.flag}</div>
                  <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary}}>{team1Key}</div>
                  <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{INT_TEAMS[team1Key]?.abbr}</div>
                </div>
                <div style={{textAlign:"center",padding:"0 16px"}}>
                  <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textMuted,letterSpacing:"0.1em"}}>vs</div>
                  <div style={{fontFamily:D.mono,fontSize:"11px",color:D.amber,marginTop:"4px"}}>{overs} ov</div>
                </div>
                <div style={{textAlign:"center",flex:1}}>
                  <div style={{fontSize:"24px",marginBottom:"4px"}}>{INT_TEAMS[team2Key]?.flag}</div>
                  <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary}}>{team2Key}</div>
                  <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{INT_TEAMS[team2Key]?.abbr}</div>
                </div>
              </div>
              <div>
                <Lbl sx={{marginBottom:"8px"}}>Toss Won By</Lbl>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                  {[[team1Key,INT_TEAMS[team1Key]?.flag],[team2Key,INT_TEAMS[team2Key]?.flag]].map(([t,flag],i)=>(
                    <button key={i} onClick={()=>setToss(i)} className="pressBtn" style={{
                      padding:"12px",borderRadius:D.md,cursor:"pointer",
                      fontFamily:D.body,fontSize:"13px",fontWeight:600,
                      border:`1px solid ${toss===i?D.emerald+"66":D.border}`,
                      background:toss===i?`${D.emerald}14`:D.surf2,
                      color:toss===i?D.emerald:D.textSecondary,transition:"all .2s",
                    }}>{flag} {t}</button>
                  ))}
                </div>
              </div>
              <div>
                <Lbl sx={{marginBottom:"8px"}}>{[team1Key,team2Key][toss]} elected to…</Lbl>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                  {["Bat","Bowl"].map((opt,i)=>(
                    <button key={i} onClick={()=>setBat(i)} className="pressBtn" style={{
                      padding:"12px",borderRadius:D.md,cursor:"pointer",
                      fontFamily:D.body,fontSize:"13px",fontWeight:600,
                      border:`1px solid ${bat===i?D.amber+"66":D.border}`,
                      background:bat===i?`${D.amber}14`:D.surf2,
                      color:bat===i?D.amber:D.textSecondary,transition:"all .2s",
                    }}>{opt}</button>
                  ))}
                </div>
              </div>
              <Btn variant="primary" size="lg" full onClick={()=>setStep(4)} sx={{borderRadius:D.md}}>
                Confirm Toss →
              </Btn>
            </div>
          )}
          {step===4&&(()=>{
            // Determine batting & bowling teams
            const first=bat===0?toss:1-toss;
            const batKey=first===0?team1Key:team2Key;
            const bowlKey=first===0?team2Key:team1Key;
            const batOrder=first===0?order1:order2;
            const setBatOrder=first===0?setOrder1:setOrder2;
            const bowlingSquad=INT_TEAMS[bowlKey]?.players.map(p=>p.name)||[];
            return (
              <OpeningSetupStep
                batKey={batKey} bowlKey={bowlKey}
                batOrder={batOrder} setBatOrder={setBatOrder}
                bowlingSquad={bowlingSquad} bowlingTeamKey={bowlKey}
                onConfirm={(opener1,opener2,openBowler)=>{
                  const sq1=first===0?order1:order2;
                  const sq2=first===0?order2:order1;
                  onStart({
                    team1:team1Key, team2:team2Key, overs, toss, bat,
                    squad1:sq1, squad2:sq2,
                    twelfth1:first===0?twelfth1:twelfth2,
                    twelfth2:first===0?twelfth2:twelfth1,
                    teamKey1:first===0?team1Key:team2Key,
                    teamKey2:first===0?team2Key:team1Key,
                    opener1, opener2, openBowler,
                  });
                }}/>
            );
          })()}
        </Glass>
      </div>
    </div>
  );
}


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
          <Lbl sx={{marginBottom:"8px"}}>Runs Scored Off This Ball</Lbl>
          <div style={{display:"flex",gap:"6px"}}>
            {[0,1,2,3,4,5,6].map(r=>(
              <button key={r} onClick={()=>setRuns(r)} className="pressBtn" style={{
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
        <Btn variant="amber" size="lg" full onClick={()=>onConfirm(nbType,runs)} sx={{borderRadius:D.md}}>
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
   BATTING ORDER MANAGER SHEET
═══════════════════════════════════════════════════════ */
function BattingOrderSheet({squad,batsmen,teamKey,twelfthMan,onSend,onClose}){
  const teamInfo=INT_TEAMS[teamKey]||null;
  const available=squad.filter(name=>{
    const played=batsmen.find(b=>b.name===name);
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
        {/* Available */}
        <Lbl sx={{marginBottom:"7px"}}>Available to Bat</Lbl>
        <div style={{display:"flex",flexDirection:"column",gap:"4px",marginBottom:"12px"}}>
          {available.map((name,i)=>{
            const ri=getRoleInfo(name);
            const pos=squad.indexOf(name)+1;
            return (
              <button key={name} onClick={()=>onSend(name)} className="pressBtn" style={{
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
                  color:i===0?D.textPrimary:D.textSecondary,flex:1}}>{name}</span>
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
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.rose}}>{b.runs}({b.balls})</span>
                </div>
              ))}
            </div>
          </details>
        )}
        <Sep sx={{marginBottom:"12px"}}/>
        <CustomBatEntry onSend={onSend}/>
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
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Player name…"
          style={{flex:1,background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
            color:D.textPrimary,fontSize:"14px",fontFamily:D.body,fontWeight:500,padding:"10px 14px",outline:"none"}}
          onKeyDown={e=>{if(e.key==="Enter"&&name.trim())onSend(name.trim());}}/>
        <Btn variant="live" disabled={!name.trim()} onClick={()=>name.trim()&&onSend(name.trim())} sx={{borderRadius:D.md,padding:"10px 18px"}}>Go</Btn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   WICKET SHEET
═══════════════════════════════════════════════════════ */
function WicketSheet({batName,fieldingSquad,onClose,onConfirm}){
  const[mode,setMode]=useState("Bowled");
  const[fielder,setFielder]=useState("");
  const[fielterFilter,setFielderFilter]=useState("");
  const modes=["Bowled","Caught","LBW","Run Out","Stumped","Hit Wicket","Handled Ball","Obstructed Field"];
  const needsFielder=mode==="Caught"||mode==="Run Out";
  const isStumped=mode==="Stumped";
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
    if(m==="Stumped"&&wkName)setFielder(wkName);
  };
  return (
    <Sheet title="WICKET!" accent={D.rose} onClose={onClose}>
      <div style={{color:D.textSecondary,fontSize:"13px",fontFamily:D.body,marginBottom:"14px",paddingTop:"4px"}}>
        {batName} is dismissed
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px",marginBottom:"14px"}}>
        {modes.map(m=>(
          <button key={m} onClick={()=>handleMode(m)} className="pressBtn" style={{
            padding:"11px",borderRadius:D.md,cursor:"pointer",fontFamily:D.body,fontSize:"13px",fontWeight:500,
            border:"1px solid "+(mode===m?D.rose+"55":D.border),
            background:mode===m?D.rose+"1a":D.surf2,
            color:mode===m?"#fca5a5":D.textSecondary,transition:"all .15s"}}>
            {m}
          </button>
        ))}
      </div>
      {isStumped&&(
        <div style={{marginBottom:"12px",padding:"10px 13px",borderRadius:D.md,
          background:D.violet+"0e",border:"1px solid "+D.violet+"33"}}>
          <Lbl sx={{marginBottom:"4px",color:D.violet}}>Wicketkeeper</Lbl>
          <div style={{fontFamily:D.body,fontSize:"13px",color:D.textPrimary,fontWeight:500}}>
            {wkName||"—"}
            {wkName&&<span style={{color:D.textMuted,fontSize:"11px",marginLeft:"6px"}}>(auto-assigned)</span>}
          </div>
        </div>
      )}
      {needsFielder&&fieldingSquad&&fieldingSquad.length>0&&(
        <div style={{marginBottom:"12px"}}>
          <Lbl sx={{marginBottom:"8px"}}>{mode==="Caught"?"Caught by":"Run out by"}</Lbl>
          <input value={fielterFilter} onChange={e=>setFielderFilter(e.target.value)}
            placeholder="Search fielder…"
            style={{width:"100%",background:D.surf2,border:"1px solid "+D.border,borderRadius:D.md,
              color:D.textPrimary,fontSize:"13px",fontFamily:D.body,padding:"9px 13px",outline:"none",marginBottom:"8px"}}/>
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
            onChange={e=>setFielder(e.target.value)} placeholder="Type any name…"
            style={{width:"100%",background:D.surf2,border:"1px solid "+D.border,borderRadius:D.md,marginTop:"6px",
              color:D.textPrimary,fontSize:"13px",fontFamily:D.body,padding:"9px 13px",outline:"none"}}/>
        </div>
      )}
      {needsFielder&&(!fieldingSquad||!fieldingSquad.length)&&(
        <div style={{marginBottom:"12px"}}>
          <Lbl sx={{marginBottom:"7px"}}>{mode==="Caught"?"Caught by":"Run out by"}</Lbl>
          <input value={fielder} onChange={e=>setFielder(e.target.value)} placeholder="Fielder name (optional)"
            style={{width:"100%",background:D.surf2,border:"1px solid "+D.border,borderRadius:D.md,
              color:D.textPrimary,fontSize:"13px",fontFamily:D.body,padding:"11px 14px",outline:"none"}}/>
        </div>
      )}
      <div style={{display:"flex",gap:"10px",marginTop:"4px"}}>
        <Btn variant="ghost" sx={{flex:1,borderRadius:D.md}} onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" sx={{flex:2,borderRadius:D.md}} onClick={()=>onConfirm(mode,displayFielder)}>Confirm Out</Btn>
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════
   NEW OVER / BOWLER SHEET
═══════════════════════════════════════════════════════ */
function NewOverSheet({ovNum,prevBowlers,bowlingSquad,bowlingTeamKey,lastBowlerName,onClose,onConfirm}){
  const[name,setName]=useState("");
  const[filter,setFilter]=useState("");
  const teamInfo=INT_TEAMS[bowlingTeamKey]||null;
  // Build full list: team bowlers first, then all-rounders, then others
  const allBowlers=teamInfo
    ? teamInfo.players.filter(p=>p.bowl)
    : (bowlingSquad||[]).map(n=>({name:n,role:"BOWL"}));
  const filtered=filter
    ? allBowlers.filter(p=>p.name.toLowerCase().includes(filter.toLowerCase()))
    : allBowlers;
  const prevNames=new Set(prevBowlers.map(b=>b.name));
  // Can't bowl consecutive overs
  const canBowl=(pname)=>pname!==lastBowlerName;
  const prevBowlerMap={};
  prevBowlers.forEach(b=>{prevBowlerMap[b.name]=b;});
  return (
    <Sheet title={ovNum===0?"Opening Bowler":`Over ${ovNum} Complete`} accent={D.amber} onClose={onClose}>
      <div style={{paddingTop:"8px"}}>
        <div style={{color:D.textSecondary,fontSize:"12px",fontFamily:D.body,marginBottom:"14px"}}>
          {ovNum===0?"Select the opening bowler.":`Select bowler for over ${ovNum+1}.`}
          {lastBowlerName&&<span style={{color:D.textMuted}}> ({lastBowlerName} cannot bowl consecutive overs)</span>}
        </div>
        {/* Search filter */}
        <div style={{marginBottom:"12px"}}>
          <input value={filter} onChange={e=>setFilter(e.target.value)}
            placeholder="Search bowler…"
            style={{width:"100%",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
              color:D.textPrimary,fontSize:"14px",fontFamily:D.body,padding:"9px 14px",outline:"none"}}
            onFocus={e=>e.target.style.borderColor=D.amber+"66"}
            onBlur={e=>e.target.style.borderColor=D.border}/>
        </div>
        {/* Previously bowled this innings — quick pick */}
        {prevBowlers.length>0&&(
          <div style={{marginBottom:"12px"}}>
            <Lbl sx={{marginBottom:"7px",color:D.amber}}>Already Bowled This Innings</Lbl>
            <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
              {prevBowlers.map(b=>{
                const dis=!canBowl(b.name);
                const ri=teamInfo?.players.find(p=>p.name===b.name);
                return (
                  <button key={b.id} onClick={()=>!dis&&onConfirm(b.name)} disabled={dis} className="pressBtn" style={{
                    display:"flex",alignItems:"center",gap:"10px",padding:"9px 12px",
                    borderRadius:D.md,cursor:dis?"not-allowed":"pointer",textAlign:"left",width:"100%",
                    border:`1px solid ${dis?D.border:D.amber+"33"}`,
                    background:dis?`${D.surf2}55`:`${D.amber}08`,opacity:dis?0.45:1,
                  }}>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:500,
                        color:dis?D.textMuted:D.textPrimary}}>{b.name}</div>
                      {dis&&<div style={{fontFamily:D.body,fontSize:"10px",color:D.rose,marginTop:"1px"}}>Cannot bowl consecutive overs</div>}
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
            const dis=!canBowl(player.name);
            const rc=ROLE_COLORS[player.role]||D.orange;
            return (
              <button key={player.name} onClick={()=>!dis&&onConfirm(player.name)} disabled={dis} className="pressBtn" style={{
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
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Bowler name…"
            style={{flex:1,background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
              color:D.textPrimary,fontSize:"14px",fontFamily:D.body,fontWeight:500,padding:"10px 14px",outline:"none"}}
            onFocus={e=>e.target.style.borderColor=D.amber+"66"} onBlur={e=>e.target.style.borderColor=D.border}
            onKeyDown={e=>{if(e.key==="Enter"&&name.trim())onConfirm(name.trim());}}/>
          <Btn variant="amber" disabled={!name.trim()} onClick={()=>name.trim()&&onConfirm(name.trim())} sx={{borderRadius:D.md,padding:"10px 18px"}}>Go</Btn>
        </div>
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════
   INNINGS BREAK SHEET
═══════════════════════════════════════════════════════ */
function Innings2Sheet({target,teamName,overs,onClose,onStart}){
  return (
    <Sheet title="Innings Break" accent={D.indigo} onClose={onClose}>
      <div style={{textAlign:"center",padding:"20px 0 24px"}}>
        <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted,marginBottom:"8px"}}>{teamName} need</div>
        <div style={{fontFamily:D.mono,fontSize:"clamp(56px,12vw,80px)",fontWeight:500,
          background:D.grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",
          lineHeight:1,letterSpacing:"-0.02em",marginBottom:"6px"}}>{target}</div>
        <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted,marginBottom:"24px"}}>runs to win in {overs} overs</div>
        <Btn variant="primary" size="lg" sx={{borderRadius:D.md,minWidth:"220px"}} onClick={onStart}>Start 2nd Innings →</Btn>
      </div>
    </Sheet>
  );
}

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

// Detect milestones on a ball
// `inn` is the PRE-ball snapshot (updInn's updater is deferred by React),
// so post-ball values must be derived from the committed ball itself.
function detectMilestone(ball,inn){
  const bat=inn?.batsmen.find(b=>b.id===ball.striker);
  const bow=inn?.bowlers.find(b=>b.id===ball.bowler);
  const milestones=[];
  if(bat&&ball.type!=="W"&&ball.type!=="Wd"&&ball.type!=="Nb"){
    const credit=ball.type==="run"?(ball.value||0):0; // byes/leg-byes don't credit the batter
    const prev=bat.runs, cur=bat.runs+credit;
    if(prev<50&&cur>=50)milestones.push({type:"fifty",label:"FIFTY!",sub:bat.name+" reaches 50",color:D.sky,icon:"🏏"});
    if(prev<100&&cur>=100)milestones.push({type:"century",label:"CENTURY!",sub:bat.name+" — 100 not out",color:D.amber,icon:"💯"});
    if(prev<150&&cur>=150)milestones.push({type:"150",label:"150!",sub:bat.name+" on 150",color:D.amber,icon:"🔥"});
    if(prev<200&&cur>=200)milestones.push({type:"200",label:"DOUBLE!",sub:bat.name+" — 200 runs!",color:D.amber,icon:"👑"});
  }
  if(bow&&ball.type==="W"){
    const wkts=(bow.wickets||0)+1; // including this dismissal
    if(wkts===5)milestones.push({type:"fifer",label:"FIFER!",sub:bow.name+" takes 5 wickets",color:D.rose,icon:"🎯"});
    if(wkts>=3){
      const legal=(inn?.ballLog||[]).filter(b=>b.type!=="Wd"&&b.type!=="Nb").slice(-2);
      if(legal.length===2&&legal.every(b=>b.type==="W"&&b.bowler===bow.id))
        milestones.push({type:"hattrick",label:"HAT-TRICK!",sub:bow.name+" — 3 in a row!",color:D.rose,icon:"🎩"});
    }
    if((inn?.wickets||0)+1>=10)milestones.push({type:"allout",label:"ALL OUT!",sub:(inn?.battingTeam||"")+" all out",color:D.rose,icon:"💀"});
  }
  // Team milestones — total includes extras
  if(inn){
    const added=(ball.type==="Wd"||ball.type==="Nb")?1+(ball.value||0):(ball.value||0);
    const prevRuns=inn.runs, postRuns=inn.runs+added;
    [50,100,150,200,250,300,350,400].forEach(n=>{
      if(prevRuns<n&&postRuns>=n)milestones.push({type:"team"+n,label:n+"!",sub:inn.battingTeam+" reach "+n,color:D.indigo,icon:"🏏"});
    });
  }
  return milestones.length>0?milestones[0]:null;
}

/* ═══════════════════════════════════════════════════════
   COMMENTARY CARD  (top-level, used inside Score tab)
═══════════════════════════════════════════════════════ */
function CommentaryCard({inn}){
  const log=[...(inn?.ballLog||[])].reverse().slice(0,8);
  const[aiLines,setAiLines]=useState({});
  const[loading,setLoading]=useState(false);
  // Generate AI commentary for the latest ball when ballLog changes
  const lastBallKey=inn?.ballLog?.length?
    (inn.ballLog[inn.ballLog.length-1].over+"_"+inn.ballLog[inn.ballLog.length-1].ballInOver):null;
  useEffect(()=>{
    if(!lastBallKey||!inn||aiLines[lastBallKey])return;
    setLoading(true);
    const latestBall=inn.ballLog[inn.ballLog.length-1];
    const mile=detectMilestone(latestBall,inn);
    fetchAICommentary(latestBall,inn,mile?mile.label:null).then(line=>{
      if(line)setAiLines(prev=>({...prev,[lastBallKey]:line}));
      setLoading(false);
    });
  },[lastBallKey]);
  const getBallKey=(b)=>b.over+"_"+b.ballInOver;
  const descBall=(b)=>{
    if(b.type==="W")return "WICKET — "+b.dismissal;
    if(b.type==="Wd")return "Wide ball";
    if(b.type==="Nb")return "No Ball ("+(b.nbType||"front foot").replace("_"," ")+"), "+(b.value||0)+"+1 runs";
    if(b.type==="Pen")return "Penalty "+b.value+" runs — "+(b.reason||"");
    if(b.type==="B")return "Bye — "+b.value+" run"+(b.value!==1?"s":"");
    if(b.type==="LB")return "Leg Bye — "+b.value+" run"+(b.value!==1?"s":"");
    if(b.value===6)return "SIX! Maximum";
    if(b.value===4)return "FOUR! Boundary";
    if(b.value===0)return "Dot ball";
    return b.value+" run"+(b.value!==1?"s":"");
  };
  return (
    <Card style={{overflow:"hidden"}}>
      <div style={{padding:"10px 14px 9px",borderBottom:"1px solid "+D.border,
        display:"flex",alignItems:"center",gap:"8px"}}>
        <Lbl>Commentary</Lbl>
        {loading&&<div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted,fontStyle:"italic"}}>AI writing…</div>}
        <div className="liveDot" style={{width:"5px",height:"5px",borderRadius:"50%",
          background:D.emerald,marginLeft:"auto",flexShrink:0}}/>
      </div>
      {log.length===0&&(
        <div style={{padding:"16px 14px",color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>
          No balls bowled yet.
        </div>
      )}
      {log.map((b,i)=>{
        const shot=b.shot?ALL_SHOTS_FLAT.find(s=>s.id===b.shot):null;
        const seg=b.seg!=null?SEGS[b.seg]:null;
        const first=i===0;
        const isWkt=b.type==="W";
        const isSix=b.value===6&&b.type==="run";
        const isFour=b.value===4&&b.type==="run";
        const accentCol=isWkt?D.rose:isSix?D.amber:isFour?D.sky:null;
        const bkey=getBallKey(b);
        const aiLine=aiLines[bkey];
        // Left accent stripe colour
        const stripeCol=isWkt?D.rose:isSix?D.amber:isFour?D.sky:first?D.indigo+"55":"transparent";
        return (
          <div key={i} style={{
            display:"flex",alignItems:"flex-start",gap:"0",
            background:first?(isWkt?D.rose+"07":isSix?D.amber+"07":isFour?D.sky+"06":D.indigo+"07"):"transparent",
            borderBottom:i<log.length-1?"1px solid "+D.border:"none",
            opacity:Math.max(0.25,1-i*0.1),
            borderLeft:"3px solid "+stripeCol,
          }}>
            <div style={{padding:"9px 10px 9px 12px",flexShrink:0}}>
              <BallDot ball={b} size={22}/>
            </div>
            <div style={{flex:1,minWidth:0,padding:"9px 12px 9px 0"}}>
              {/* Over + ball indicator */}
              <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"3px"}}>
                <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,flexShrink:0}}>
                  {(b.over+1)}.{b.ballInOver+1}
                </span>
                {b.bowlerApproach&&<Badge color={D.amber} sx={{fontSize:"7px",padding:"1px 5px"}}>{b.bowlerApproach==="Around the wicket"?"Around":"Over"}</Badge>}
                {isWkt&&<Badge color={D.rose} sx={{fontSize:"7px",padding:"1px 5px"}}>WICKET</Badge>}
                {isSix&&<Badge color={D.amber} sx={{fontSize:"7px",padding:"1px 5px"}}>SIX</Badge>}
                {isFour&&<Badge color={D.sky} sx={{fontSize:"7px",padding:"1px 5px"}}>FOUR</Badge>}
              </div>
              {/* AI commentary line */}
              {aiLine&&(
                <div style={{fontFamily:D.body,fontSize:first?"13px":"12px",fontWeight:first?500:400,
                  color:accentCol||D.textPrimary,marginBottom:"4px",lineHeight:1.45}}>
                  {aiLine}
                </div>
              )}
              {/* Fallback mechanical description */}
              {!aiLine&&(
                <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:first?600:400,
                  color:accentCol||D.textPrimary}}>
                  {first&&loading?"Generating commentary…":descBall(b)}
                </div>
              )}
              {/* Metadata tags */}
              <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"2px",
                display:"flex",gap:"7px",flexWrap:"wrap",alignItems:"center"}}>
                {shot&&<span style={{color:shot.color}}>{shot.icon+" "+shot.label}</span>}
                {seg&&<span>{"📍 "+seg.label+(b.zone==="boundary"?" · Boundary":"")}</span>}
                {b.bowlerApproach&&<span style={{color:D.amber}}>{"⤵ "+b.bowlerApproach}</span>}
                <span>{"Ov "+(b.over+1)+"."+(b.ballInOver+1)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════
   SCORING HUB  — 3-stage inline card
   stage 0: Shot picker (icon grid + approach + extras)
   stage 1: Wagon wheel field placement
   stage 2: Run selector + Wicket
═══════════════════════════════════════════════════════ */
function ScoringHub({inn,innings,curIn,match,hubStage,hubShot,hubApproach,selSeg,
  fieldView,setFieldView,hidden,toggleLine,setModal,
  onApproach,onShot,onShotSkip,onFieldSel,onRun,onBye,onLegBye,onWicket,onWide,onNoBall,onReset,onBack}){
  const shotInfo=hubShot?ALL_SHOTS_FLAT.find(s=>s.id===hubShot):null;
  const segInfo=selSeg!=null?SEGS[selSeg.seg]:null;
  const STAGE_LABELS=["Shot","Field","Runs"];
  return (
    <Card style={{overflow:"hidden"}}>
      {/* Stage breadcrumb header */}
      <div style={{padding:"10px 14px",borderBottom:"1px solid "+D.border,
        display:"flex",alignItems:"center",gap:"5px",flexWrap:"wrap"}}>
        <Lbl sx={{marginRight:"4px",flexShrink:0}}>Scoring Hub</Lbl>
        {STAGE_LABELS.map((s,i)=>(
          <Fragment key={s}>
            <div style={{
              padding:"2px 9px",borderRadius:D.pill,
              fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",
              background:i===hubStage?D.grad:i<hubStage?D.emerald+"18":"transparent",
              color:i===hubStage?"#fff":i<hubStage?D.emerald:D.textMuted,
              border:"1px solid "+(i===hubStage?D.indigo+"55":i<hubStage?D.emerald+"33":D.border),
              transition:"all .25s",
            }}>{i<hubStage?"✓ ":""}{s}</div>
            {i<2&&<div style={{width:"5px",height:"1px",background:D.border}}/>}
          </Fragment>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:"6px"}}>
          {hubStage>0&&(
            <button onClick={onBack} className="pressBtn" style={{
              padding:"3px 11px",borderRadius:D.pill,border:"1px solid "+D.border,
              background:"transparent",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>
              ← Back
            </button>
          )}
          {hubStage>0&&(
            <button onClick={onReset} className="pressBtn" style={{
              padding:"3px 10px",borderRadius:D.pill,border:"1px solid "+D.border,
              background:"transparent",cursor:"pointer",fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* STAGE 0: Approach toggle + Shot icon grid */}
      {hubStage===0&&(
        <div style={{padding:"12px 14px"}}>
          {/* Approach selector — required before shot selection */}
          <div style={{marginBottom:"14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"8px"}}>
              <Lbl>Bowler Approach</Lbl>
              {!hubApproach&&<span style={{fontFamily:D.body,fontSize:"10px",color:D.rose,fontWeight:500}}>⚠ Required</span>}
              {hubApproach&&<span style={{fontFamily:D.body,fontSize:"10px",color:D.emerald,fontWeight:500}}>✓ Set</span>}
              <div style={{marginLeft:"auto",display:"flex",gap:"5px"}}>
                <button onClick={onWide} className="pressBtn" style={{
                  padding:"4px 10px",borderRadius:D.pill,border:"1px solid "+D.orange+"44",
                  background:D.orange+"10",color:D.orange,cursor:"pointer",
                  fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.05em"}}>WIDE</button>
                <button onClick={onNoBall} className="pressBtn" style={{
                  padding:"4px 10px",borderRadius:D.pill,border:"1px solid "+D.amber+"44",
                  background:D.amber+"10",color:D.amber,cursor:"pointer",
                  fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.05em"}}>NO BALL</button>
              </div>
            </div>
            {/* Toggle switch */}
            <div style={{display:"flex",background:D.surf2,borderRadius:D.pill,padding:"3px",border:"1px solid "+D.border,position:"relative"}}>
              {["Over the wicket","Around the wicket"].map((a,i)=>{
                const isActive=hubApproach===a;
                return (
                  <button key={a} onClick={()=>onApproach(a)} className="pressBtn" style={{
                    flex:1,padding:"8px 12px",borderRadius:D.pill,cursor:"pointer",border:"none",
                    fontFamily:D.body,fontSize:"12px",fontWeight:isActive?600:400,
                    background:isActive?"linear-gradient(135deg,"+D.indigo+","+D.sky+")"  :"transparent",
                    color:isActive?"#fff":D.textMuted,
                    transition:"all .2s cubic-bezier(.34,1.56,.64,1)",
                    boxShadow:isActive?"0 2px 12px "+D.indigo+"40":"none",
                  }}>
                    {i===0?"🔄 Over the Wicket":"↩️ Around the Wicket"}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Shot grid — locked until approach selected */}
          {!hubApproach&&(
            <div style={{padding:"20px",textAlign:"center",borderRadius:D.md,border:"1px dashed "+D.border,
              background:D.surf2+"88",marginBottom:"10px"}}>
              <div style={{fontSize:"24px",marginBottom:"8px"}}>🏏</div>
              <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted}}>Select approach above to enable shot selection</div>
            </div>
          )}
          {hubApproach&&SHOT_CATS.map(cat=>(
            <div key={cat.cat} style={{marginBottom:"10px"}}>
              <Lbl sx={{marginBottom:"6px",color:cat.color}}>{cat.cat}</Lbl>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"5px"}}>
                {cat.shots.map(shot=>(
                  <button key={shot.id} onClick={()=>onShot(shot.id)} className="pressBtn" style={{
                    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                    gap:"3px",padding:"9px 4px",borderRadius:D.md,cursor:"pointer",
                    border:"1px solid "+D.border,background:D.surf2,transition:"all .15s"}}>
                    <span style={{fontSize:"18px",lineHeight:1}}>{shot.icon}</span>
                    <span style={{fontFamily:D.body,fontSize:"9px",fontWeight:500,
                      color:D.textSecondary,textAlign:"center",lineHeight:1.2}}>{shot.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {hubApproach&&<button onClick={onShotSkip} className="pressBtn" style={{
            width:"100%",padding:"8px",borderRadius:D.md,border:"1px solid "+D.border,
            background:"transparent",cursor:"pointer",color:D.textMuted,
            fontFamily:D.body,fontSize:"11px",marginTop:"4px"}}>Skip shot →</button>}
        </div>
      )}

      {/* STAGE 1: Wagon wheel field placement */}
      {hubStage===1&&(
        <div style={{padding:"12px 14px"}}>
          <div style={{display:"flex",gap:"7px",marginBottom:"10px",flexWrap:"wrap",alignItems:"center"}}>
            {shotInfo&&(
              <div style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 10px",
                borderRadius:D.md,background:shotInfo.color+"12",border:"1px solid "+shotInfo.color+"25"}}>
                <span style={{fontSize:"14px"}}>{shotInfo.icon}</span>
                <span style={{fontFamily:D.body,fontSize:"11px",color:shotInfo.color}}>{shotInfo.label}</span>
              </div>
            )}
            {!shotInfo&&<span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>No shot</span>}
            {hubApproach&&<Badge color={D.amber} sx={{fontSize:"8px"}}>{hubApproach==="Around the wicket"?"Around":"Over"}</Badge>}
            <span style={{fontFamily:D.body,fontSize:"11px",color:D.amber,fontWeight:500,marginLeft:"auto"}}>
              📍 Tap field to place
            </span>
          </div>
          <WagonWheel
            ballLog={inn?.ballLog||[]}
            selSeg={selSeg}
            onSel={s=>{if(s)onFieldSel(s);}}
            viewMode={fieldView}
            onViewMode={setFieldView}
            hidden={hidden}
            onToggle={toggleLine}/>
        </div>
      )}

      {/* STAGE 2: Run selector */}
      {hubStage===2&&(
        <div style={{padding:"12px 14px"}}>
          <div style={{display:"flex",gap:"6px",marginBottom:"12px",flexWrap:"wrap",alignItems:"center"}}>
            {shotInfo&&(
              <div style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 10px",
                borderRadius:D.md,background:shotInfo.color+"12",border:"1px solid "+shotInfo.color+"25"}}>
                <span style={{fontSize:"13px"}}>{shotInfo.icon}</span>
                <span style={{fontFamily:D.body,fontSize:"11px",color:shotInfo.color}}>{shotInfo.label}</span>
              </div>
            )}
            {segInfo&&(
              <div style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 10px",
                borderRadius:D.md,background:D.indigo+"10",border:"1px solid "+D.indigo+"22"}}>
                <span style={{fontSize:"11px"}}>📍</span>
                <span style={{fontFamily:D.body,fontSize:"11px",color:D.sky}}>
                  {segInfo.label+(selSeg?.zone==="boundary"?" · Boundary":selSeg?.zone==="outer"?" · Outfield":"")}
                </span>
              </div>
            )}
            {hubApproach&&<Badge color={D.amber} sx={{fontSize:"8px"}}>{hubApproach==="Around the wicket"?"Around":"Over"}</Badge>}
          </div>
          <Lbl sx={{marginBottom:"8px"}}>Runs Scored</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"5px",marginBottom:"9px"}}>
            {[0,1,2,3,4,5,6].map(r=>(
              <button key={r} onClick={()=>onRun(r)} className="pressBtn" style={{
                padding:"15px 0",borderRadius:D.md,cursor:"pointer",
                fontFamily:D.mono,fontSize:r===6?"20px":"16px",fontWeight:500,
                border:"1px solid "+(r===4?D.indigo+"55":r===6?D.amber+"55":D.border),
                background:r===4?D.indigo+"18":r===6?D.amber+"18":D.surf2,
                color:r===4?D.sky:r===6?D.amber:D.textPrimary,
                transition:"all .12s",
                boxShadow:r===4?"0 0 12px "+D.indigo+"15":r===6?"0 0 12px "+D.amber+"15":"none",
              }}>{r}</button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px",marginBottom:"9px"}}>
            {[["Bye","B"],["Leg Bye","LB"]].map(([l,t])=>(
              <button key={t} onClick={()=>t==="B"?onBye():onLegBye()} className="pressBtn" style={{
                padding:"9px",borderRadius:D.md,cursor:"pointer",
                border:"1px solid "+D.violet+"33",background:D.violet+"08",
                color:D.violet,fontFamily:D.head,fontSize:"10px",fontWeight:700,
                letterSpacing:"0.05em",textTransform:"uppercase"}}>{l}</button>
            ))}
          </div>
          <button onClick={onWicket} className="pressBtn" style={{
            width:"100%",padding:"13px",borderRadius:D.md,cursor:"pointer",
            border:"1px solid "+D.rose+"44",background:D.rose+"0e",
            color:D.rose,fontFamily:D.head,fontSize:"13px",fontWeight:700,
            letterSpacing:"0.06em",textTransform:"uppercase",
            boxShadow:"0 4px 20px "+D.rose+"15",transition:"all .15s"}}>
            ⚡ Wicket
          </button>
        </div>
      )}

      {/* Quick utilities — always visible */}
      <div style={{padding:"10px 14px",borderTop:"1px solid "+D.border,display:"flex",flexDirection:"column",gap:"6px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"6px"}}>
          <Btn variant="ghost" size="sm" sx={{borderRadius:D.md}} onClick={()=>setModal("newOver")}>Chg Bowler</Btn>
          <Btn variant="ghost" size="sm" sx={{borderRadius:D.md}} onClick={()=>setModal("penalty")}>Penalty</Btn>
          <Btn variant="ghost" size="sm" sx={{borderRadius:D.md}} onClick={()=>setModal("editOrder")}>Bat Order</Btn>
        </div>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════
   SCORING PANEL  (assembles hero, batsmen, bowler, hub, commentary)
═══════════════════════════════════════════════════════ */
function ScoringPanel({inn,innings,curIn,match,hubStage,hubShot,hubApproach,selSeg,
  freeHit,fieldView,setFieldView,hidden,toggleLine,setModal,scoreKey,
  onApproach,onShot,onShotSkip,onFieldSel,onRun,onBye,onLegBye,onWicket,onWide,onNoBall,onReset,onBack,onUndo}){
  const bat1=inn?.batsmen.find(b=>b.id===inn.striker);
  const bat2=inn?.batsmen.find(b=>b.id===inn.nonStriker);
  const bow=inn?.bowlers.find(b=>b.id===inn.bowler);
  const overBalls=(()=>{
    if(!inn)return[];
    const ov=Math.floor(inn.balls/6);
    return inn.overLog.find(o=>o.over===ov)?.balls||[];
  })();
  const target=curIn===1?(innings[0]?.runs||0)+1:null;
  const maxBalls=(match?.overs||20)*6;
  const phase=inn?getPhase(inn.balls,match?.overs||20):"POWERPLAY";
  const phaseCol=phase==="POWERPLAY"?D.emerald:phase==="MIDDLE"?D.amber:D.orange;
  const rrr=target&&inn?.balls<maxBalls?((target-(inn?.runs||0))/((maxBalls-(inn?.balls||0))/6)).toFixed(2):"—";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      <Glass glow={D.indigo} style={{padding:0}}>
        <div className="gradAnim" style={{height:"3px",background:"linear-gradient(90deg,"+D.indigo+","+D.sky+","+D.emerald+","+D.indigo+")",backgroundSize:"200% 100%"}}/>
        <div style={{padding:"16px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              <div className="liveDot liveGlow" style={{width:"8px",height:"8px",borderRadius:"50%",background:D.emerald}}/>
              <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.emerald,letterSpacing:"0.18em",textTransform:"uppercase"}}>LIVE</span>
              <Badge color={phaseCol}>{phase}</Badge>
              <Badge color={D.sky}>{"Inn "+(curIn+1)}</Badge>
            </div>
            <Badge color={D.textMuted}>{(match?.overs||20)+" ov"}</Badge>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:"12px"}}>
            <div style={{flex:1}}>
              <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"2px"}}>{inn?.battingTeam}</div>
              <div key={scoreKey} className="scoreAnim" style={{fontFamily:D.mono,fontSize:"clamp(42px,5vw,54px)",fontWeight:500,color:D.textPrimary,lineHeight:1,letterSpacing:"-0.025em"}}>
                {inn?.runs||0}<span style={{color:D.textMuted,fontSize:"clamp(28px,3.5vw,36px)",fontWeight:400}}>{"/"+(inn?.wickets||0)}</span>
              </div>
              <div style={{marginTop:"6px",display:"flex",gap:"7px",alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>{fmtOv(inn?.balls||0)} ov</span>
                <span style={{width:"1px",height:"10px",background:D.border,flexShrink:0}}/>
                <div style={{display:"flex",alignItems:"baseline",gap:"3px"}}>
                  <span style={{fontFamily:D.mono,fontSize:"15px",fontWeight:500,color:D.sky,lineHeight:1}}>{RR(inn?.runs||0,inn?.balls||0)}</span>
                  <span style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted}}>RR</span>
                </div>
                {freeHit&&<span style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.08em",
                  color:"#fff",background:"linear-gradient(135deg,#f97316,#f59e0b)",
                  padding:"2px 8px",borderRadius:D.pill}}>⚡ FREE HIT</span>}
              </div>
            </div>
            {target&&(
              <div style={{background:D.surf2,border:"1px solid "+D.border,borderRadius:D.lg,padding:"9px 13px",textAlign:"right",flexShrink:0}}>
                <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"2px"}}>Target</div>
                <div style={{fontFamily:D.mono,fontSize:"24px",fontWeight:500,background:D.grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",lineHeight:1}}>{target}</div>
                <div style={{color:D.orange,fontSize:"10px",fontFamily:D.body,marginTop:"3px"}}>{"Need "+Math.max(0,target-(inn?.runs||0))+" off "+(maxBalls-(inn?.balls||0))+"b"}</div>
                <div style={{color:D.textMuted,fontSize:"10px",fontFamily:D.mono,marginTop:"1px"}}>{"RRR "+rrr}</div>
              </div>
            )}
          </div>
          <div style={{marginTop:"12px",paddingTop:"10px",borderTop:"1px solid "+D.border}}>
            <div style={{display:"flex",alignItems:"center",gap:"7px",flexWrap:"wrap"}}>
              <Lbl>This over</Lbl>
              {overBalls.length===0
                ?<span style={{color:D.textMuted,fontSize:"10px",fontFamily:D.body,fontStyle:"italic"}}>new over</span>
                :overBalls.map((b,i)=>(<BallDot key={i} ball={b} size={24}/>))
              }
              {overBalls.length>0&&<span style={{color:D.textSecondary,fontSize:"10px",fontFamily:D.mono,marginLeft:"auto"}}>{overBalls.reduce((s,b)=>s+(b.value||0),0)+" runs"}</span>}
            </div>
          </div>
        </div>
      </Glass>
      <Card accent={D.emerald}>
        <div style={{padding:"8px 13px 5px",display:"grid",gridTemplateColumns:"1fr 28px 28px 22px 22px 38px",gap:"3px",borderBottom:"1px solid "+D.border}}>
          {["Batsman","R","B","4s","6s","SR"].map(h=>(<Lbl key={h} sx={{textAlign:h==="Batsman"?"left":"right"}}>{h}</Lbl>))}
        </div>
        {[bat1,bat2].filter(Boolean).map((b,i)=>(
          <div key={b.id} style={{padding:"7px 13px",display:"grid",gridTemplateColumns:"1fr 28px 28px 22px 22px 38px",gap:"3px",
            background:i%2?D.surf2+"44":"transparent",borderBottom:"1px solid "+D.border,alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
              {b.id===inn?.striker
                ?<div className="liveDot" style={{width:"5px",height:"5px",borderRadius:"50%",background:D.emerald,flexShrink:0}}/>
                :<div style={{width:"5px",height:"5px",flexShrink:0}}/>}
              <span style={{color:D.textPrimary,fontSize:"13px",fontFamily:D.body,fontWeight:500}}>{b.name}</span>
            </div>
            {[b.runs,b.balls,b.fours,b.sixes,SR(b.runs,b.balls)].map((v,j)=>(
              <div key={j} style={{textAlign:"right",fontFamily:D.mono,fontSize:"12px",
                fontWeight:j===0?"500":"400",
                color:j===0?D.textPrimary:j===2?D.indigo:j===3?D.amber:j===4?D.textMuted:D.textSecondary}}>{v}</div>
            ))}
          </div>
        ))}
        {!bat1&&(
          <button onClick={()=>setModal("opener")} style={{width:"100%",padding:"10px",background:"transparent",
            border:"none",color:D.textMuted,cursor:"pointer",fontFamily:D.body,fontSize:"13px"}}>
            + Set opening pair
          </button>
        )}
      </Card>
      {bow&&(
        <Card accent={D.orange}>
          <div style={{padding:"8px 13px 5px",display:"grid",gridTemplateColumns:"1fr 34px 20px 28px 22px 38px",gap:"3px",borderBottom:"1px solid "+D.border}}>
            {["Bowler","O","M","R","W","Econ"].map(h=>(<Lbl key={h} sx={{textAlign:h==="Bowler"?"left":"right"}}>{h}</Lbl>))}
          </div>
          <div style={{padding:"7px 13px",display:"grid",gridTemplateColumns:"1fr 34px 20px 28px 22px 38px",gap:"3px",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
              <span style={{color:D.orange,fontSize:"12px"}}>⚡</span>
              <span style={{color:D.textPrimary,fontSize:"13px",fontFamily:D.body,fontWeight:500}}>{bow.name}</span>
              {bow.bowlArm&&<span style={{fontFamily:D.mono,fontSize:"8px",fontWeight:700,padding:"1px 4px",borderRadius:D.pill,
                background:`${D.violet}15`,border:`1px solid ${D.violet}33`,color:D.violet,flexShrink:0}}>
                {bow.bowlArm==="L"?"LA":"RA"}{bow.bowlStyle==="S"?"S":bow.bowlStyle==="M"?"M":"F"}
              </span>}
            </div>
            {[fmtOv(bow.balls),bow.maidens,bow.runs,bow.wickets,RR(bow.runs,bow.balls)].map((v,i)=>(
              <div key={i} style={{textAlign:"right",fontFamily:D.mono,fontSize:"12px",
                fontWeight:i===3?"500":"400",color:i===3?D.rose:D.textPrimary}}>{v}</div>
            ))}
          </div>
        </Card>
      )}
      <ScoringHub
        inn={inn} innings={innings} curIn={curIn} match={match}
        hubStage={hubStage} hubShot={hubShot} hubApproach={hubApproach}
        selSeg={selSeg}
        fieldView={fieldView} setFieldView={setFieldView}
        hidden={hidden} toggleLine={toggleLine}
        setModal={setModal}
        onApproach={onApproach} onShot={onShot} onShotSkip={onShotSkip}
        onFieldSel={onFieldSel} onRun={onRun} onBye={onBye} onLegBye={onLegBye}
        onWicket={onWicket} onWide={onWide} onNoBall={onNoBall} onReset={onReset}
        onBack={onBack}/>
      <CommentaryCard inn={inn}/>
      {/* Undo last ball */}
      {inn?.ballLog?.length>0&&onUndo&&(
        <button onClick={onUndo} className="pressBtn" style={{
          display:"flex",alignItems:"center",justifyContent:"center",gap:"7px",
          width:"100%",padding:"10px",borderRadius:D.md,cursor:"pointer",
          border:"1px solid "+D.border,background:"transparent",
          color:D.textMuted,fontFamily:D.body,fontSize:"12px",
          animation:"undoPop .3s cubic-bezier(.22,1,.36,1)",
          transition:"all .15s",
        }}>
          <span style={{fontSize:"14px"}}>↩</span>
          <span>Undo last ball</span>
          <span style={{fontFamily:D.mono,fontSize:"10px",opacity:.5,marginLeft:"auto"}}>
            {inn.ballLog.length} ball{inn.ballLog.length!==1?"s":""}
          </span>
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   INTEL DASHBOARD TAB
═══════════════════════════════════════════════════════ */
/* ──────────────────────────────
   ANALYSIS CHARTS
────────────────────────────── */
function WormChart({innings,curIn,match}){
  const overs=match?.overs||20;
  const maxBalls=overs*6;
  const inn1=innings[0];const inn2=innings[1];
  // Build worm data points per ball from each innings
  const mkWorm=(inn)=>{
    if(!inn||!inn.ballLog.length)return{pts:[],wkts:[]};
    const pts=[{ball:0,runs:0}];const wkts=[];
    let runs=0;
    inn.ballLog.filter(b=>b.type!=="Wd"&&b.type!=="Nb"&&b.type!=="Pen").forEach((b,i)=>{
      runs+=(b.value||0);
      const ball=i+1;
      pts.push({ball,runs});
      if(b.type==="W"){
        const bat=inn.batsmen.find(x=>x.id===b.striker);
        wkts.push({ball,runs,n:wkts.length+1,name:bat?bat.name:(b.dismissal||"Wicket"),mode:b.dismissal||""});
      }
    });
    return{pts,wkts};
  };
  const d1=mkWorm(inn1),d2=mkWorm(inn2);
  const w1=d1.pts,w2=d2.pts;const wk1=d1.wkts,wk2=d2.wkts;
  const maxR=Math.max(20,...w1.map(p=>p.runs),...w2.map(p=>p.runs));
  const W=500,H=160,PAD={t:16,r:12,b:28,l:40};
  const cw=W-PAD.l-PAD.r,ch=H-PAD.t-PAD.b;
  const xScale=b=>(b/maxBalls)*cw;
  const yScale=r=>ch-(r/maxR)*ch;
  const mkPath=(pts)=>pts.length<2?"":pts.map((p,i)=>(i===0?"M":"L")+((xScale(p.ball))+","+yScale(p.runs).toFixed(1))).join(" ");
  const xTicks=Array.from({length:overs+1},(_,i)=>i);
  const yTicks=[0,Math.round(maxR/4),Math.round(maxR/2),Math.round(3*maxR/4),maxR];
  return (
    <Card style={{padding:"14px 16px"}}>
      <Lbl sx={{marginBottom:"10px"}}>Worm — Runs & Wickets</Lbl>
      <svg width="100%" viewBox={"0 0 "+W+" "+H} preserveAspectRatio="xMidYMid meet" style={{overflow:"visible"}}>
        <g transform={"translate("+PAD.l+","+PAD.t+")"}>
          {/* Grid */}
          {yTicks.map(v=>(
            <g key={v}>
              <line x1={0} y1={yScale(v)} x2={cw} y2={yScale(v)} stroke={D.border} strokeWidth={1}/>
              <text x={-6} y={yScale(v)+4} textAnchor="end" fill={D.textMuted} fontSize={9} fontFamily={D.mono}>{v}</text>
            </g>
          ))}
          {xTicks.filter(v=>v%5===0).map(v=>(
            <text key={v} x={xScale(v*6)} y={ch+16} textAnchor="middle" fill={D.textMuted} fontSize={9} fontFamily={D.mono}>{v}</text>
          ))}
          {/* Worm lines */}
          {w1.length>1&&<path d={mkPath(w1)} fill="none" stroke={D.sky} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.9}/>}
          {w2.length>1&&<path d={mkPath(w2)} fill="none" stroke={D.amber} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.9}/>}
          {/* Area fills */}
          {w1.length>1&&<path d={mkPath(w1)+"L"+xScale(w1[w1.length-1].ball)+","+ch+"L0,"+ch+"Z"} fill={D.sky} opacity={0.06}/>}
          {w2.length>1&&<path d={mkPath(w2)+"L"+xScale(w2[w2.length-1].ball)+","+ch+"L0,"+ch+"Z"} fill={D.amber} opacity={0.06}/>}
          {/* Axes */}
          <line x1={0} y1={0} x2={0} y2={ch} stroke={D.border} strokeWidth={1}/>
          <line x1={0} y1={ch} x2={cw} y2={ch} stroke={D.border} strokeWidth={1}/>
          {/* Wicket markers — drop-line to the over axis + labelled node */}
          {[[wk1,D.sky],[wk2,D.amber]].map(([wk,col],gi)=>wk.map((m,i)=>(
            <g key={gi+"-"+i}>
              <line x1={xScale(m.ball)} y1={yScale(m.runs)} x2={xScale(m.ball)} y2={ch} stroke={D.rose} strokeWidth={1} strokeDasharray="2 3" opacity={0.4}/>
              <circle cx={xScale(m.ball)} cy={yScale(m.runs)} r={4.5} fill={D.rose} stroke={col} strokeWidth={1.5}>
                <title>{"W"+m.n+" · "+m.runs+" ("+m.name+(m.mode?", "+m.mode:"")+")"}</title>
              </circle>
            </g>
          )))}
        </g>
      </svg>
      <div style={{display:"flex",gap:"16px",marginTop:"8px"}}>
        {inn1&&<div style={{display:"flex",alignItems:"center",gap:"5px"}}>
          <div style={{width:"18px",height:"2px",background:D.sky,borderRadius:"1px"}}/>
          <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{inn1.battingTeam}</span>
        </div>}
        {inn2&&inn2.ballLog.length>0&&<div style={{display:"flex",alignItems:"center",gap:"5px"}}>
          <div style={{width:"18px",height:"2px",background:D.amber,borderRadius:"1px"}}/>
          <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{inn2.battingTeam}</span>
        </div>}
        {(wk1.length>0||wk2.length>0)&&<div style={{display:"flex",alignItems:"center",gap:"5px"}}>
          <div style={{width:"9px",height:"9px",borderRadius:"50%",background:D.rose,border:`1.5px solid ${D.surf1}`}}/>
          <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Wicket</span>
        </div>}
      </div>
    </Card>
  );
}

function ManhattanChart({inn,match}){
  const overs=match?.overs||20;
  if(!inn||!inn.overLog.length)return(
    <Card style={{padding:"14px 16px"}}>
      <Lbl sx={{marginBottom:"8px"}}>Manhattan — Runs per Over</Lbl>
      <div style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px",padding:"16px 0"}}>No completed overs yet.</div>
    </Card>
  );
  const ovData=Array.from({length:overs},(_,i)=>{
    const ov=inn.overLog.find(o=>o.over===i);
    if(!ov)return{over:i,runs:0,wickets:0,complete:false};
    const runs=ov.balls.reduce((s,b)=>s+(b.value||0),0);
    const wickets=ov.balls.filter(b=>b.type==="W").length;
    const complete=ov.balls.filter(b=>b.type!=="Wd"&&b.type!=="Nb").length===6;
    return{over:i,runs,wickets,complete};
  });
  const maxR=Math.max(1,...ovData.map(o=>o.runs));
  const W=500,H=150,PAD={t:12,r:8,b:28,l:32};
  const cw=W-PAD.l-PAD.r,ch=H-PAD.t-PAD.b;
  const barW=Math.max(4,cw/overs-2);
  const barColor=(r,w)=>w>0?D.rose:r>=12?D.amber:r>=8?D.sky:D.indigo;
  return (
    <Card style={{padding:"14px 16px"}}>
      <Lbl sx={{marginBottom:"10px"}}>Manhattan — Runs per Over</Lbl>
      <svg width="100%" viewBox={"0 0 "+W+" "+H} preserveAspectRatio="xMidYMid meet" style={{overflow:"visible"}}>
        <g transform={"translate("+PAD.l+","+PAD.t+")"}>
          {[0,Math.round(maxR/2),maxR].map(v=>(
            <g key={v}>
              <line x1={0} y1={ch-(v/maxR)*ch} x2={cw} y2={ch-(v/maxR)*ch} stroke={D.border} strokeWidth={1}/>
              <text x={-5} y={ch-(v/maxR)*ch+4} textAnchor="end" fill={D.textMuted} fontSize={8} fontFamily={D.mono}>{v}</text>
            </g>
          ))}
          {ovData.filter(o=>o.complete||o.over<Math.floor((inn.balls||0)/6)).map((o,i)=>{
            const bh=(o.runs/maxR)*ch;
            const bx=(i/overs)*cw+(cw/overs-barW)/2;
            const by=ch-bh;
            return (
              <g key={i}>
                <rect x={bx} y={by} width={barW} height={Math.max(1,bh)}
                  fill={barColor(o.runs,o.wickets)} opacity={0.8} rx={2}/>
                {o.wickets>0&&<text x={bx+barW/2} y={Math.max(by-3,2)} textAnchor="middle" fill={D.rose} fontSize={8} fontFamily={D.mono}>{"W".repeat(o.wickets)}</text>}
                {overs<=20&&<text x={bx+barW/2} y={ch+14} textAnchor="middle" fill={D.textMuted} fontSize={8} fontFamily={D.mono}>{o.over+1}</text>}
              </g>
            );
          })}
          <line x1={0} y1={ch} x2={cw} y2={ch} stroke={D.border} strokeWidth={1}/>
        </g>
      </svg>
      <div style={{display:"flex",gap:"12px",marginTop:"6px",flexWrap:"wrap"}}>
        {[{c:D.indigo,l:"0–7"},{c:D.sky,l:"8–11"},{c:D.amber,l:"12+"},{c:D.rose,l:"Wicket"}].map(({c,l})=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:"4px"}}>
            <div style={{width:"10px",height:"10px",borderRadius:"2px",background:c,opacity:.85}}/>
            <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{l}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RunRateChart({inn,match,target}){
  const overs=match?.overs||20;
  if(!inn||!inn.overLog.length)return null;
  // Build RR per over and required RR per over
  const pts=[];let cumRuns=0;
  for(let ov=0;ov<overs;ov++){
    const ovLog=inn.overLog.find(o=>o.over===ov);
    if(!ovLog)break;
    const legalBalls=ovLog.balls.filter(b=>b.type!=="Wd"&&b.type!=="Nb").length;
    if(legalBalls<6)break;
    cumRuns+=ovLog.balls.reduce((s,b)=>s+(b.value||0),0);
    const rr=cumRuns/((ov+1));
    const ballsDone=(ov+1)*6;
    const reqRr=target?Math.max(0,(target-cumRuns)/((overs*6-ballsDone)/6)):null;
    pts.push({over:ov+1,rr,reqRr});
  }
  if(pts.length<2)return null;
  const maxRR=Math.max(12,...pts.map(p=>Math.max(p.rr,p.reqRr||0)));
  const W=500,H=130,PAD={t:12,r:8,b:26,l:36};
  const cw=W-PAD.l-PAD.r,ch=H-PAD.t-PAD.b;
  const xS=v=>(v/overs)*cw;const yS=v=>ch-Math.min(1,v/maxRR)*ch;
  const mkP=(pts,key)=>pts.map((p,i)=>(i===0?"M":"L")+xS(p.over)+","+yS(p[key]).toFixed(1)).join(" ");
  return (
    <Card style={{padding:"14px 16px"}}>
      <Lbl sx={{marginBottom:"10px"}}>Run Rate</Lbl>
      <svg width="100%" viewBox={"0 0 "+W+" "+H} preserveAspectRatio="xMidYMid meet" style={{overflow:"visible"}}>
        <g transform={"translate("+PAD.l+","+PAD.t+")"}>
          {[0,Math.round(maxRR/2),maxRR].map(v=>(
            <g key={v}>
              <line x1={0} y1={yS(v)} x2={cw} y2={yS(v)} stroke={D.border} strokeWidth={1}/>
              <text x={-5} y={yS(v)+4} textAnchor="end" fill={D.textMuted} fontSize={8} fontFamily={D.mono}>{v.toFixed(0)}</text>
            </g>
          ))}
          <path d={mkP(pts,"rr")} fill="none" stroke={D.emerald} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
          <path d={mkP(pts,"rr")+"L"+xS(pts[pts.length-1].over)+","+ch+"L0,"+ch+"Z"} fill={D.emerald} opacity={0.06}/>
          {target&&<path d={mkP(pts.filter(p=>p.reqRr!=null),"reqRr")} fill="none" stroke={D.rose} strokeWidth={1.5} strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round"/>}
          <line x1={0} y1={0} x2={0} y2={ch} stroke={D.border} strokeWidth={1}/>
          <line x1={0} y1={ch} x2={cw} y2={ch} stroke={D.border} strokeWidth={1}/>
          {pts.filter((_,i)=>i%5===4||(i===pts.length-1)).map(p=>(
            <text key={p.over} x={xS(p.over)} y={ch+14} textAnchor="middle" fill={D.textMuted} fontSize={8} fontFamily={D.mono}>{p.over}</text>
          ))}
        </g>
      </svg>
      <div style={{display:"flex",gap:"14px",marginTop:"6px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
          <div style={{width:"16px",height:"2px",background:D.emerald,borderRadius:"1px"}}/>
          <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Run Rate</span>
        </div>
        {target&&<div style={{display:"flex",alignItems:"center",gap:"5px"}}>
          <div style={{width:"16px",height:"2px",background:D.rose,borderRadius:"1px",borderTop:"2px dashed "+D.rose}}/>
          <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Required RR</span>
        </div>}
      </div>
    </Card>
  );
}

function BatsmanChart({inn}){
  if(!inn)return null;
  const batters=inn.batsmen.filter(b=>b.balls>0).sort((a,b2)=>b2.runs-a.runs).slice(0,6);
  if(!batters.length)return null;
  const maxR=Math.max(1,...batters.map(b=>b.runs));
  return (
    <Card style={{padding:"14px 16px"}}>
      <Lbl sx={{marginBottom:"10px"}}>Top Batsmen</Lbl>
      <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
        {batters.map((b,i)=>{
          const pct=b.runs/maxR;
          const sr=b.balls>0?(b.runs/b.balls*100).toFixed(0):0;
          const col=i===0?D.amber:i===1?D.sky:D.indigo;
          return (
            <div key={b.id}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"3px"}}>
                <span style={{fontFamily:D.body,fontSize:"12px",color:b.status==="batting"?D.emerald:D.textSecondary,fontWeight:500}}>{b.name}{b.status==="batting"?"*":""}</span>
                <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textPrimary}}>{b.runs}<span style={{color:D.textMuted,fontSize:"10px"}}> ({b.balls}b · SR {sr})</span></span>
              </div>
              <div style={{height:"6px",borderRadius:"3px",background:D.surf2,overflow:"hidden"}}>
                <div style={{height:"100%",width:(pct*100)+"%",borderRadius:"3px",background:col,transition:"width .5s ease"}}/>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function BowlerChart({inn}){
  if(!inn)return null;
  const bowlers=inn.bowlers.filter(b=>b.balls>0).sort((a,b2)=>b2.wickets-a.wickets||a.runs-b2.runs).slice(0,6);
  if(!bowlers.length)return null;
  const maxWkt=Math.max(1,...bowlers.map(b=>b.wickets));
  const maxR=Math.max(1,...bowlers.map(b=>b.runs));
  return (
    <Card style={{padding:"14px 16px"}}>
      <Lbl sx={{marginBottom:"10px"}}>Bowling Performance</Lbl>
      <div style={{display:"flex",flexDirection:"column",gap:"9px"}}>
        {bowlers.map((b,i)=>{
          const econ=(b.balls>0?b.runs/(b.balls/6):0).toFixed(2);
          const econCol=parseFloat(econ)<6?D.emerald:parseFloat(econ)<9?D.amber:D.rose;
          return (
            <div key={b.id} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:"8px",alignItems:"center",
              padding:"8px 10px",background:D.surf2,borderRadius:D.md,
              border:"1px solid "+(b.id===inn.bowler?D.orange+"44":D.border)}}>
              <span style={{fontFamily:D.body,fontSize:"12px",color:b.id===inn.bowler?D.orange:D.textPrimary,fontWeight:500}}>{b.name}{b.id===inn.bowler?"*":""}</span>
              <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textMuted}}>{Math.floor(b.balls/6)+"-"+(b.balls%6)}</span>
              <span style={{fontFamily:D.mono,fontSize:"12px",color:b.wickets>0?D.rose:D.textSecondary,fontWeight:b.wickets?"600":"400"}}>{b.wickets+"W-"+b.runs+"R"}</span>
              <Badge color={econCol} sx={{fontSize:"9px"}}>{econ}</Badge>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AnalysisDashboard({inn,match,curIn,innings}){
  const overs=match?.overs||20;
  const target=curIn===1?(innings[0]?.runs||0)+1:null;
  const isChase=curIn===1;
  const sig=buildSignals(inn,overs,target,isChase);
  const[activeView,setActiveView]=useState("charts");
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      {/* Sub-nav */}
      <div style={{display:"flex",gap:"6px"}}>
        {[["charts","📊 Charts"],["signals","📡 Signals"],["intelligence","🧠 Intelligence"]].map(([id,label])=>(
          <button key={id} onClick={()=>setActiveView(id)} className="pressBtn" style={{
            padding:"7px 16px",borderRadius:D.pill,cursor:"pointer",border:"none",
            fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",
            background:activeView===id?D.grad:"rgba(255,255,255,0.05)",
            color:activeView===id?"#fff":D.textMuted,
            boxShadow:activeView===id?"0 4px 16px "+D.indigo+"40":"none",
            transition:"all .2s"}}>
            {label}
          </button>
        ))}
      </div>
      {activeView==="charts"&&(
        <div className="sc-grid-2">
          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
            <WormChart innings={innings} curIn={curIn} match={match}/>
            <RunRateChart inn={inn} match={match} target={target}/>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
            <ManhattanChart inn={inn} match={match}/>
            <BatsmanChart inn={inn}/>
            <BowlerChart inn={inn}/>
          </div>
        </div>
      )}
      {activeView==="signals"&&(
        <div className="sc-grid-2">
          {sig&&(
            <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
              <Card style={{padding:"18px"}}>
                <Lbl sx={{marginBottom:"14px"}}>Signal Dashboard</Lbl>
                <div style={{display:"flex",flexDirection:"column",gap:"13px"}}>
                  <SignalBar label="Pressure" value={sig.pressure+"%"} pct={sig.pressure} color={sig.pressureColor}/>
                  <SignalBar label="Momentum" value={sig.momLabel} pct={50+sig.mom/2} color={sig.momColor} center/>
                  <SignalBar label="Run Rate" value={sig.rr} pct={Math.min(100,sig.rr/18*100)} color={D.sky}/>
                  <SignalBar label="Dots / 6" value={sig.dotsL6} pct={sig.dotsL6/6*100} color={sig.dotsL6>=4?D.rose:D.textSecondary}/>
                  <SignalBar label="Bnds / 12" value={sig.bndsL12} pct={sig.bndsL12/6*100} color={D.amber}/>
                  <SignalBar label="Wkts / 12" value={sig.wktsL12} pct={sig.wktsL12/3*100} color={sig.wktsL12>=2?D.rose:D.textSecondary}/>
                </div>
              </Card>
              {sig.flags.length>0&&(
                <Card style={{padding:"16px"}}>
                  <Lbl sx={{marginBottom:"10px"}}>Active Flags</Lbl>
                  <div style={{display:"flex",flexWrap:"wrap",gap:"7px"}}>
                    {sig.flags.map(f=>(
                      <Badge key={f} color={f.includes("ON_TRACK")||f.includes("STABIL")?D.emerald:f.includes("BEHIND")||f.includes("RISK")||f.includes("HAT")?D.rose:D.amber}>
                        {f.replace(/_/g," ")}
                      </Badge>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            <BatsmanChart inn={inn}/>
            <BowlerChart inn={inn}/>
          </div>
        </div>
      )}
      {activeView==="intelligence"&&(
        <div className="sc-grid-2">
          <IntelPanel inn={inn} overs={overs} target={target} isChase={isChase}/>
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            <BatsmanChart inn={inn}/>
            <BowlerChart inn={inn}/>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   UTIL
═══════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════
   EVENT OVERLAY — fullscreen flash for 4, 6, WICKET, milestones
═══════════════════════════════════════════════════════ */
// event: {label,sub,color,glow,bg,icon?,isMilestone?}
function EventOverlay({event,onDone,suppressBlur}){
  const[phase,setPhase]=useState("in");
  const duration=event?.isMilestone?2400:1700;
  // Re-arm per event: when the parent chains a queued overlay (e.g. SIX →
  // FIFTY) the component stays mounted with a new `event` prop. A mount-only
  // effect would never schedule timers for the second overlay, leaving the
  // blurred backdrop on screen permanently.
  useEffect(()=>{
    if(!event)return;
    setPhase("in");
    const t1=setTimeout(()=>setPhase("out"),duration-400);
    const t2=setTimeout(onDone,duration);
    return()=>{clearTimeout(t1);clearTimeout(t2);};
  },[event]);
  if(!event)return null;
  const {label,sub,color,glow,bg,icon,isMilestone}=event;
  // Confetti pieces for milestones
  const confetti=isMilestone?Array.from({length:18},(_,i)=>({
    x:Math.sin(i/18*Math.PI*2)*120,
    delay:(i*0.08)%0.7,
    col:["#f59e0b","#0ea5e9","#10b981","#f43f5e","#7c3aed","#f97316"][i%6],
    rot:i*23,
  })):[];
  // Blocking blur is suppressed whenever a sheet/modal is open, evaluated
  // live at render time so it stays correct for queued overlays too.
  const nb=event?.noBlur||suppressBlur;
  return (
    <div style={{
      position:"fixed",inset:0,zIndex:nb?200:9999,pointerEvents:"none",
      background:nb?"transparent":(bg||"rgba(0,0,0,.1)"),
      backdropFilter:nb?"none":"blur(2px)",
    }}>
      <div style={{
        position:"absolute",top:"50%",left:"50%",
        animation:phase==="in"
          ?(isMilestone?"milestoneIn .5s cubic-bezier(.22,1,.36,1) both":"overlayIn .4s cubic-bezier(.22,1,.36,1) both")
          :"milestoneOut .45s ease forwards",
        textAlign:"center",
      }}>
        {/* Icon for milestones */}
        {icon&&<div style={{fontSize:"clamp(40px,8vw,70px)",lineHeight:1,marginBottom:"8px"}}>{icon}</div>}
        <div style={{
          fontFamily:D.mono,
          fontSize:isMilestone?"clamp(52px,12vw,96px)":"clamp(60px,14vw,110px)",
          fontWeight:700,lineHeight:1,
          color,
          textShadow:`0 0 40px ${glow||color+"88"},0 0 80px ${glow||color+"44"},0 4px 0 rgba(0,0,0,.5)`,
          letterSpacing:"-0.02em",
          ...(isMilestone?{
            background:"linear-gradient(135deg,"+color+","+color+"99,"+color+")",
            backgroundSize:"200% auto",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",
            animation:"goldShimmer 1.2s linear infinite",
          }:{}),
        }}>{label}</div>
        <div style={{
          fontFamily:D.head,fontSize:"clamp(14px,3vw,22px)",fontWeight:700,
          letterSpacing:"0.2em",color,opacity:.8,
          textTransform:"uppercase",marginTop:"8px",
          animation:isMilestone?"bounceIn .5s .2s cubic-bezier(.22,1,.36,1) both":"none",
        }}>{sub}</div>
        {/* Radiating rings */}
        {[0,1,2].map(i=>(
          <div key={i} style={{
            position:"absolute",top:"50%",left:"50%",borderRadius:"50%",
            transform:"translate(-50%,-50%)",
            width:((i+1)*(isMilestone?220:180))+"px",height:((i+1)*(isMilestone?220:180))+"px",
            border:"2px solid "+color,opacity:0,
            animation:`fadeIn .1s ${0.05+i*0.12}s forwards, overlayOut .7s ${0.2+i*0.12}s forwards`,
          }}/>
        ))}
        {/* Confetti for milestones */}
        {confetti.map((c,i)=>(
          <div key={i} style={{
            position:"absolute",top:"50%",left:"50%",
            width:"8px",height:"8px",borderRadius:"2px",
            background:c.col,
            transform:`translate(calc(-50% + ${c.x}px), -50%) rotate(${c.rot}deg)`,
            opacity:0,
            animation:`confetti .9s ${c.delay}s ease-out forwards`,
          }}/>
        ))}
      </div>
    </div>
  );
}

// Build event config from ball value or milestone object
function buildEventCfg(ballValue,milestone){
  if(milestone)return{
    label:milestone.label,sub:milestone.sub,
    color:milestone.color,bg:milestone.color+"08",
    icon:milestone.icon,isMilestone:true,
  };
  if(ballValue===4)return{label:"FOUR!",sub:"Boundary",color:D.sky,glow:"rgba(14,165,233,.5)",bg:"rgba(14,165,233,.06)"};
  if(ballValue===6)return{label:"SIX!",sub:"Maximum!",color:D.amber,glow:"rgba(245,158,11,.6)",bg:"rgba(245,158,11,.06)"};
  if(ballValue==="W")return{label:"WICKET!",sub:"Out",color:D.rose,glow:"rgba(244,63,94,.5)",bg:"rgba(244,63,94,.06)"};
  return null;
}

/* ═══════════════════════════════════════════════════════
   FREE HIT BANNER — shown when next ball is a free hit
═══════════════════════════════════════════════════════ */
function FreeHitBanner({onDismiss}){
  return (
    <div style={{
      position:"fixed",top:"72px",left:"50%",transform:"translateX(-50%)",
      zIndex:1000,padding:"10px 24px",borderRadius:D.pill,
      background:"linear-gradient(135deg,#f97316,#f59e0b)",
      boxShadow:"0 0 0 4px rgba(249,115,22,.3)",
      animation:"freeHitPulse 1s ease infinite, bounceIn .4s cubic-bezier(.22,1,.36,1)",
      display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",
    }} onClick={onDismiss}>
      <span style={{fontSize:"20px"}}>⚡</span>
      <div>
        <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:800,color:"#fff",letterSpacing:"0.1em"}}>FREE HIT!</div>
        <div style={{fontFamily:D.body,fontSize:"10px",color:"rgba(255,255,255,.8)"}}>Next ball: batter can only be run out</div>
      </div>
      <span style={{fontSize:"20px"}}>⚡</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   PARTNERSHIP CARD
═══════════════════════════════════════════════════════ */
function PartnershipCard({inn}){
  if(!inn)return null;
  const cur=inn.curPartner;
  const hist=inn.partnerships||[];
  const bat1=inn.batsmen.find(b=>b.id===inn.striker);
  const bat2=inn.batsmen.find(b=>b.id===inn.nonStriker);
  const maxRuns=Math.max(1,...hist.map(p=>p.runs),(cur?.runs||0));
  return (
    <Card style={{overflow:"hidden"}}>
      <div style={{padding:"10px 14px 9px",borderBottom:"1px solid "+D.border}}>
        <Lbl>Partnerships</Lbl>
      </div>
      {/* Current partnership */}
      {bat1&&bat2&&(
        <div style={{padding:"12px 14px",background:D.indigo+"08",borderBottom:"1px solid "+D.border}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
              <div className="liveDot" style={{width:"6px",height:"6px",borderRadius:"50%",background:D.emerald}}/>
              <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary}}>
                {bat1.name} & {bat2.name}
              </span>
            </div>
            <div style={{display:"flex",gap:"14px",alignItems:"baseline"}}>
              <div style={{textAlign:"right"}}>
                <div style={{fontFamily:D.mono,fontSize:"22px",fontWeight:500,color:D.textPrimary,lineHeight:1}}>{cur?.runs||0}</div>
                <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted,textAlign:"center"}}>{cur?.balls||0}b</div>
              </div>
              {(cur?.balls||0)>0&&(
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:D.mono,fontSize:"12px",color:D.textSecondary}}>{RR(cur.runs,cur.balls)}</div>
                  <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>RR</div>
                </div>
              )}
            </div>
          </div>
          {/* Partnership bar */}
          <div style={{height:"4px",background:D.surf3,borderRadius:"4px",overflow:"hidden"}}>
            <div style={{height:"100%",borderRadius:"4px",
              background:"linear-gradient(90deg,"+D.indigo+","+D.sky+")",
              width:Math.min(100,((cur?.runs||0)/maxRuns)*100)+"%",
              transition:"width .4s ease"}}/>
          </div>
        </div>
      )}
      {/* Partnership history */}
      {hist.length>0&&(
        <div style={{padding:"8px 14px"}}>
          <Lbl sx={{marginBottom:"7px",color:D.textMuted}}>Batting Partnerships</Lbl>
          {hist.map((p,i)=>(
            <div key={i} style={{marginBottom:"8px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"3px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                  <span style={{fontFamily:D.mono,fontSize:"10px",color:D.rose,fontWeight:600}}>{p.wicket-1}/{p.wicket}</span>
                  <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{p.bat1} & {p.bat2}</span>
                </div>
                <div style={{display:"flex",gap:"10px",alignItems:"baseline"}}>
                  <span style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:D.textPrimary}}>{p.runs}</span>
                  <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{p.balls}b</span>
                  <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textSecondary}}>{RR(p.runs,p.balls)}</span>
                </div>
              </div>
              <div style={{height:"3px",background:D.surf3,borderRadius:"3px",overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:"3px",
                  background:"linear-gradient(90deg,"+D.violet+"99,"+D.indigo+"66)",
                  width:Math.min(100,(p.runs/maxRuns)*100)+"%"}}/>
              </div>
            </div>
          ))}
        </div>
      )}
      {!bat1&&!bat2&&hist.length===0&&(
        <div style={{padding:"16px 14px",color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>
          No partnerships recorded yet.
        </div>
      )}
    </Card>
  );
}

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
  return { cfg:{team1,team2,overs,squad1,squad2,teamKey1:team1,teamKey2:team2}, innings:[inn,inn2], curIn:0 };
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
SCRBRD.seedLiveResume=seedLiveResume;

/* ═══════════════════════════════════════════════════════
   FOCUS PAD — distraction-free one-tap scoring surface.
   Rich shot/field capture lives one toggle away in Pro mode.
═══════════════════════════════════════════════════════ */
function FocusPad({inn,match,curIn,target,onCommitDetailed,onWicketCtx,onWide,onNoBall,onUndo,onPro,quick,onToggleQuick}){
  const [phase,setPhase]=useState(1);      // 1 Shot · 2 Area · 3 Outcome
  const [shot,setShot]=useState(null);
  const [area,setArea]=useState(null);     // {seg,zone} | null (didn't travel)
  const [wagonView,setWagonView]=useState("wagon");
  const [hidden]=useState(()=>new Set());
  if(!inn)return null;

  const reset=()=>{setPhase(1);setShot(null);setArea(null);};
  const shotMeta=shot?ALL_SHOTS_FLAT.find(s=>s.id===shot):null;
  // Off pads/body = leg byes; beaten & ran = byes; otherwise off the bat.
  const runType=(v)=>{ if(v<=0)return "run"; if(shot==="padded"||shot==="hit_body")return "LB"; if(shot==="missed")return "B"; return "run"; };
  const commitRun=(v)=>{ onCommitDetailed(runType(v), v, shot, area?.seg??null, area?.zone??null); reset(); };
  const commitWkt=()=>{ onWicketCtx(shot, area?.seg??null, area?.zone??null); reset(); };

  const st=inn.batsmen.find(b=>b.id===inn.striker);
  const ns=inn.batsmen.find(b=>b.id===inn.nonStriker);
  const bw=inn.bowlers.find(b=>b.id===inn.bowler);
  const crr=inn.balls?((inn.runs/inn.balls)*6).toFixed(2):"0.00";
  const lastBalls=inn.ballLog.slice(-8);
  const req=target!=null?target-inn.runs:null;
  const ballsLeft=(match?.overs||20)*6-inn.balls;

  const ContextStrip=(
    <Card style={{padding:"14px 16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:"10px"}}>
        <div style={{fontFamily:D.mono,fontSize:"26px",fontWeight:700,color:D.textPrimary}}>
          {inn.runs}/{inn.wickets}<span style={{fontSize:"13px",color:D.textMuted}}> ({fmtOv(inn.balls)})</span>
        </div>
        <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textSecondary,textAlign:"right"}}>
          CRR {crr}{req!=null&&<div style={{color:req<=ballsLeft?D.emerald:D.rose}}>{req>0?`need ${req} off ${ballsLeft}`:"target reached"}</div>}
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:"4px",fontFamily:D.body,fontSize:"12px"}}>
        <div style={{display:"flex",justifyContent:"space-between"}}>
          <span style={{color:D.textPrimary,fontWeight:600}}>● {st?st.name:"—"}</span>
          <span style={{fontFamily:D.mono,color:D.textSecondary}}>{st?`${st.runs} (${st.balls})`:""}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between"}}>
          <span style={{color:D.textSecondary}}>{ns?ns.name:"—"}</span>
          <span style={{fontFamily:D.mono,color:D.textMuted}}>{ns?`${ns.runs} (${ns.balls})`:""}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",paddingTop:"5px",borderTop:`1px solid ${D.border}`}}>
          <span style={{color:D.textSecondary}}>🎳 {bw?bw.name:"—"}</span>
          <span style={{fontFamily:D.mono,color:D.textMuted}}>{bw?`${bw.wickets}/${bw.runs} (${fmtOv(bw.balls)})`:""}</span>
        </div>
      </div>
      {lastBalls.length>0&&(
        <div style={{display:"flex",gap:"5px",marginTop:"10px",overflowX:"auto"}}>
          {lastBalls.map((b,i)=><BallDot key={i} ball={b} size={24}/>)}
        </div>
      )}
    </Card>
  );

  // ── Quick mode: one-tap pad (speed over detail) ──
  const K=({label,sub,onClick,bg,fg,border,span,disabled})=>(
    <button onClick={onClick} disabled={disabled} className="pressBtn" style={{
      gridColumn:span?`span ${span}`:"auto",minHeight:"60px",borderRadius:D.lg,cursor:disabled?"default":"pointer",opacity:disabled?.4:1,
      background:bg||D.surf2,border:`1px solid ${border||D.border}`,
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"2px"}}>
      <span style={{fontFamily:D.mono,fontSize:"21px",fontWeight:700,color:fg||D.textPrimary,lineHeight:1}}>{label}</span>
      {sub&&<span style={{fontFamily:D.head,fontSize:"7px",fontWeight:700,letterSpacing:"0.12em",color:D.textMuted}}>{sub}</span>}
    </button>
  );
  if(quick){
    return (
      <div style={{maxWidth:"560px",margin:"0 auto",display:"flex",flexDirection:"column",gap:"12px"}}>
        {ContextStrip}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"8px"}}>
          <K label="·" sub="DOT" onClick={()=>onCommitDetailed("run",0,null,null,null)}/>
          <K label="1" onClick={()=>onCommitDetailed("run",1,null,null,null)}/>
          <K label="2" onClick={()=>onCommitDetailed("run",2,null,null,null)}/>
          <K label="3" onClick={()=>onCommitDetailed("run",3,null,null,null)}/>
          <K label="4" onClick={()=>onCommitDetailed("run",4,null,null,null)} bg={D.indigo+"1c"} fg={D.indigo} border={D.indigo+"44"}/>
          <K label="6" onClick={()=>onCommitDetailed("run",6,null,null,null)} bg={D.amber+"1c"} fg={D.amber} border={D.amber+"44"}/>
          <K label="WD" sub="WIDE" onClick={onWide} bg={D.orange+"14"} fg={D.orange} border={D.orange+"33"}/>
          <K label="NB" sub="NO BALL" onClick={onNoBall} bg={D.amber+"10"} fg={D.amber} border={D.amber+"2a"}/>
          <K label="W" sub="WICKET" onClick={()=>onWicketCtx(null,null,null)} bg={D.rose+"1c"} fg={D.rose} border={D.rose+"44"}/>
          <K label="↩" sub="UNDO" onClick={onUndo} span={2}/>
          <button onClick={onToggleQuick} className="pressBtn" style={{minHeight:"60px",borderRadius:D.lg,cursor:"pointer",background:D.emerald+"12",border:`1px solid ${D.emerald}33`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"3px"}}>
            <span style={{fontSize:"14px"}}>🧭</span>
            <span style={{fontFamily:D.head,fontSize:"7px",fontWeight:700,letterSpacing:"0.1em",color:D.emerald}}>3-PHASE</span>
          </button>
        </div>
        <button onClick={onPro} className="pressBtn" style={{padding:"9px",borderRadius:D.lg,cursor:"pointer",background:"transparent",border:`1px dashed ${D.borderMed}`,fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",color:D.textSecondary}}>🎯 PRO MODE — full capture</button>
      </div>
    );
  }

  // ── 3-phase guided flow ──
  const StepChip=({n,label,val,done,onClick})=>{
    const active=phase===n;
    return (
      <button onClick={done?onClick:undefined} className="pressBtn" style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",gap:"2px",
        padding:"7px 6px",borderRadius:D.md,cursor:done?"pointer":"default",
        background:active?D.indigo+"1c":done?D.emerald+"12":D.surf2,
        border:`1px solid ${active?D.indigo+"55":done?D.emerald+"33":D.border}`}}>
        <span style={{fontFamily:D.head,fontSize:"7px",fontWeight:700,letterSpacing:"0.1em",color:active?D.indigo:done?D.emerald:D.textMuted}}>
          {done?"✓ ":""}{n} · {label}
        </span>
        <span style={{fontFamily:D.body,fontSize:"11px",fontWeight:600,color:val?D.textPrimary:D.textMuted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>{val||"—"}</span>
      </button>
    );
  };
  const shotChip=(s)=>{
    const on=shot===s.id;
    return (
      <button key={s.id} onClick={()=>{setShot(s.id);setPhase(2);}} className="pressBtn" style={{
        display:"flex",alignItems:"center",gap:"5px",padding:"9px 12px",borderRadius:D.md,cursor:"pointer",
        background:on?s.color+"22":D.surf2,border:`1px solid ${on?s.color+"66":D.border}`}}>
        <span style={{fontSize:"13px"}}>{s.icon}</span>
        <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:on?s.color:D.textPrimary}}>{s.label}</span>
      </button>
    );
  };

  return (
    <div style={{maxWidth:"560px",margin:"0 auto",display:"flex",flexDirection:"column",gap:"12px"}}>
      {ContextStrip}

      {/* Phase stepper */}
      <div style={{display:"flex",gap:"6px"}}>
        <StepChip n={1} label="SHOT"    val={shotMeta?shotMeta.label:null} done={phase>1} onClick={()=>setPhase(1)}/>
        <StepChip n={2} label="AREA"    val={area?SEGS[area.seg].label:(phase>2?"Didn’t travel":null)} done={phase>2} onClick={()=>setPhase(2)}/>
        <StepChip n={3} label="OUTCOME" val={null} done={false}/>
      </div>

      {/* PHASE 1 — shot played */}
      {phase===1&&(
        <Card style={{padding:"12px 14px"}}>
          {SHOT_CATS.map(c=>(
            <div key={c.cat} style={{marginBottom:"10px"}}>
              <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:c.color,marginBottom:"6px"}}>{c.cat}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>{c.shots.map(shotChip)}</div>
            </div>
          ))}
          <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"2px"}}>Tap the shot the batter played → then mark where it went.</div>
        </Card>
      )}

      {/* PHASE 2 — area on the field */}
      {phase===2&&(
        <Card style={{padding:"14px"}}>
          <WagonWheel ballLog={inn.ballLog} selSeg={area} onSel={(s)=>{setArea(s);setPhase(3);}}
            viewMode={wagonView} onViewMode={setWagonView} hidden={hidden} onToggle={()=>{}}/>
          <div style={{display:"flex",gap:"8px",marginTop:"12px"}}>
            <button onClick={()=>setPhase(1)} className="pressBtn" style={{flex:1,padding:"12px",borderRadius:D.lg,cursor:"pointer",background:D.surf2,border:`1px solid ${D.border}`,color:D.textSecondary,fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.05em"}}>‹ SHOT</button>
            <button onClick={()=>{setArea(null);setPhase(3);}} className="pressBtn" style={{flex:2,padding:"12px",borderRadius:D.lg,cursor:"pointer",background:D.surf3,border:`1px solid ${D.borderMed}`,color:D.textSecondary,fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.05em"}}>DIDN’T TRAVEL / BLOCKED ›</button>
          </div>
          <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"8px",textAlign:"center"}}>Tap where the ball went on the field.</div>
        </Card>
      )}

      {/* PHASE 3 — runs or wicket */}
      {phase===3&&(
        <Card style={{padding:"14px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"8px",marginBottom:"8px"}}>
            {[0,1,2,3,4,6].map(v=>(
              <button key={v} onClick={()=>commitRun(v)} className="pressBtn" style={{minHeight:"62px",borderRadius:D.lg,cursor:"pointer",
                background:v===6?D.amber+"1c":v===4?D.indigo+"1c":v===0?D.surf2:D.emerald+"14",
                border:`1px solid ${v===6?D.amber+"44":v===4?D.indigo+"44":v===0?D.border:D.emerald+"33"}`,
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                <span style={{fontFamily:D.mono,fontSize:"22px",fontWeight:700,color:v===6?D.amber:v===4?D.indigo:v===0?D.textPrimary:D.emerald}}>{v===0?"·":v}</span>
                {v===0&&<span style={{fontFamily:D.head,fontSize:"7px",fontWeight:700,letterSpacing:"0.12em",color:D.textMuted}}>DOT</span>}
              </button>
            ))}
          </div>
          {/* byes / leg-byes transparency */}
          {(shot==="padded"||shot==="hit_body")&&<div style={{fontFamily:D.body,fontSize:"10px",color:D.orange,marginBottom:"8px",textAlign:"center"}}>Runs off the pads will be recorded as leg-byes.</div>}
          {shot==="missed"&&<div style={{fontFamily:D.body,fontSize:"10px",color:D.orange,marginBottom:"8px",textAlign:"center"}}>Runs after a miss will be recorded as byes.</div>}
          <button onClick={commitWkt} className="pressBtn" style={{width:"100%",padding:"14px",borderRadius:D.lg,cursor:"pointer",
            background:D.rose+"1c",border:`1px solid ${D.rose}55`,color:D.rose,fontFamily:D.head,fontSize:"13px",fontWeight:800,letterSpacing:"0.08em",marginBottom:"8px"}}>
            🎯 WICKET
          </button>
          <button onClick={()=>setPhase(2)} className="pressBtn" style={{width:"100%",padding:"10px",borderRadius:D.lg,cursor:"pointer",background:D.surf2,border:`1px solid ${D.border}`,color:D.textSecondary,fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.05em"}}>‹ AREA</button>
        </Card>
      )}

      {/* Extras strip — not shots, always available */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"8px"}}>
        <K label="WD" sub="WIDE" onClick={onWide} bg={D.orange+"14"} fg={D.orange} border={D.orange+"33"}/>
        <K label="NB" sub="NO BALL" onClick={onNoBall} bg={D.amber+"10"} fg={D.amber} border={D.amber+"2a"}/>
        <K label="↩" sub="UNDO" onClick={()=>{ if(phase>1){reset();} else {onUndo();} }} bg={D.surf2}/>
      </div>

      {/* Mode toggles */}
      <div style={{display:"flex",gap:"8px"}}>
        <button onClick={onToggleQuick} className="pressBtn" style={{flex:1,padding:"9px",borderRadius:D.lg,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.08em",color:D.textSecondary}}>⚡ QUICK MODE</button>
        <button onClick={onPro} className="pressBtn" style={{flex:1,padding:"9px",borderRadius:D.lg,cursor:"pointer",background:"transparent",border:`1px dashed ${D.borderMed}`,fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.08em",color:D.textSecondary}}>🎯 PRO MODE</button>
      </div>
      <div style={{textAlign:"center",fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>
        {phase===1?"Phase 1 of 3 — select the shot played.":phase===2?"Phase 2 of 3 — select where it landed.":"Phase 3 of 3 — score runs or a wicket."} · Undo backs out of the current ball.
      </div>
    </div>
  );
}

SCRBRD.seedCompletedMatch=seedCompletedMatch;
SCRBRD.charts={WormChart,ManhattanChart,RunRateChart,BatsmanChart,BowlerChart};

return SCRBRD;
})();

export default function SCRBRD_OS() {
  // ── App-level state ──
  const [appState,  setAppState]  = useState("landing"); // landing|login|onboarding|app
  const [role,      setRole]      = useState("superadmin");
  const [userName,  setUserName]  = useState("Super Admin");
  const [page,      setPage]      = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  // Lifted users state so ManagementView + SettingsView share the same source of truth
  const [users,     setUsers]     = useState(USERS_INITIAL);
  const [scorerOpen, setScorerOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState(null);
  const [scorerResume, setScorerResume] = useState(null);
  const isMobile = useIsMobile();

  const handleRoleChange = (r) => {
    setRole(r);
    const nav = ROLES[r]?.nav || [];
    if (!nav.includes(page)) setPage(nav[0]);
  };

  // Auth handlers
  const handleLandingEnter = () => setAppState("onboarding");
  const handleLandingLogin  = () => setAppState("login");

  const handleLogin = (r, n) => {
    setRole(r); setUserName(n || ROLES[r]?.label || "User");
    const nav = ROLES[r]?.nav || [];
    setPage(nav[0] || "dashboard");
    setAppState("app");
  };

  const handleLoginSignUp = () => setAppState("onboarding");

  const handleOnboardComplete = (r, n, schoolId) => {
    setRole(r || "player");
    setUserName(n || ROLES[r]?.label || "User");
    const nav = ROLES[r]?.nav || [];
    setPage(nav[0] || "dashboard");
    setAppState("app");
  };

  // Launch scorer — with full mid-match state when opened from a live match
  const openScorer = (m) => {
    if (!canScore(role)) return;   // RBAC: scoring is a write capability
    if (m && m.status === "live" && m.scorecard?.home) {
      const { runs, wkts } = parseScore(m.scorecard.home.score);
      setScorerResume(ScorerApp.seedLiveResume({
        matchId: m.id, team1: m.homeTeam, team2: m.awayTeam, overs: 20,
        runs, wickets: wkts, balls: parseBalls(m.scorecard.home.overs),
        squad1: teamSquad(m.homeTeam), squad2: teamSquad(m.awayTeam),
      }));
    } else setScorerResume(null);
    setScorerOpen(true);
  };

  const unreadCount = NOTIFICATIONS.filter(n=>!n.read).length;

  // ── Auth screens ──
  if (appState === "landing") return (
    <><style>{GLOBAL_CSS}</style>
      <LandingPage onEnter={handleLandingEnter} onLogin={handleLandingLogin}/>
    </>
  );
  if (appState === "login") return (
    <><style>{GLOBAL_CSS}</style>
      <LoginPage onLogin={handleLogin} onSignUp={handleLoginSignUp}/>
    </>
  );
  if (appState === "onboarding") return (
    <><style>{GLOBAL_CSS}</style>
      <OnboardingFlow onComplete={handleOnboardComplete}/>
    </>
  );

  // ── Live Scorer — full-screen takeover ──
  if (scorerOpen && canScore(role)) return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div className="scorer-shell"><ScorerApp key={scorerResume?scorerResume.cfg.team1+scorerResume.innings[0].balls:"new"} resume={scorerResume}/></div>
      <button className="os-exit-scorer pressBtn" onClick={()=>{setScorerOpen(false);setScorerResume(null);}}>
        ‹ SCRBRD OS
      </button>
    </>
  );

  // ── Main app ──
  const VIEW_MAP = {
    dashboard:    <DashboardView     role={role} onNav={setPage}/>,
    matches:      <MatchCentreView   role={role} onOpenScorer={openScorer} onNavProfile={(id)=>{setProfileTarget(id);setPage("profiles");}}/>,
    competitions: <CompetitionsView  role={role}/>,
    leagues:      <LeagueView        role={role}/>,
    squad:        <SquadView         role={role}/>,
    profiles:     <ProfilesView      role={role} profileTarget={profileTarget} onClearTarget={()=>setProfileTarget(null)}/>,
    analytics:    <AnalyticsView     role={role}/>,
    skills:       <SkillsView        role={role}/>,
    training:     <TrainingView      role={role}/>,
    injuries:     <InjuryView        role={role}/>,
    logistics:    <LogisticsView     role={role}/>,
    calendar:     <CalendarView      role={role} onNav={setPage}/>,
    fields:       <FieldsView        role={role}/>,
    staff:        <StaffView         role={role}/>,
    notifications:<NotificationsView role={role}/>,
    settings:     <SettingsView      role={role} users={users} setUsers={setUsers}/>,
    management:   <ManagementView    role={role} users={users} setUsers={setUsers}/>,
    rulebook:     <RulebookView      role={role}/>,
    pitchdeck:    <PitchDeckView     role={role}/>,
  };

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div className="os-shell" style={{display:"flex",minHeight:"100vh",background:D.bg}}>
        {!isMobile&&<Sidebar role={role} active={page} onNav={setPage} collapsed={collapsed} onToggle={()=>setCollapsed(!collapsed)} notifCount={unreadCount}/>}
        <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,overflow:"hidden"}}>
          <TopBar role={role} onRoleChange={handleRoleChange} onNav={setPage} userName={userName}/>
          <main className="os-main" style={{flex:1,overflowY:"auto"}}>
            {VIEW_MAP[page] || VIEW_MAP.dashboard}
          </main>
        </div>
        {isMobile&&<MobileNav role={role} active={page} onNav={setPage} notifCount={unreadCount}/>}
      </div>
    </>
  );
}
