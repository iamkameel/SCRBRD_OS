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

export { NAV_META, ROLES };
