import { ROLES } from "../design/roles.js";
import { D } from "../design/tokens.js";

// ── DATE HELPERS (must be before any data that uses them) ──
const today   = new Date();

const dateStr = (d) => d.toISOString().split("T")[0];

const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };

const pctDays = (inj, rtw) => {
  const total = (new Date(rtw)-new Date(inj))/(1000*60*60*24);
  const done  = (today-new Date(inj))/(1000*60*60*24);
  return Math.min(100, Math.max(0, Math.round((done/total)*100)));
};

const initials = (name) => name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();

const severityColor = (s) => s==="severe"?D.rose:s==="moderate"?D.orange:D.amber;

const fitnessColor  = (f) => f==="fit"?D.emerald:f==="injured"?D.rose:f==="rehab"?D.orange:D.amber;

const roleColor = (r) => ROLES[r]?.color||D.textMuted;

export { addDays, dateStr, fitnessColor, initials, pctDays, roleColor, severityColor, today };
