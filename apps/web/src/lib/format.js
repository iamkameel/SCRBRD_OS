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

/**
 * A derived figure, or an em dash when there isn't one.
 *
 * Career statistics are computed from the ball log, and several of them are
 * genuinely undefined rather than zero: a batter who has never been dismissed
 * has no average, a player who has not bowled has no economy rate. The read
 * layer sends null for those on purpose.
 *
 * Rendering null directly puts an empty gap where a number goes, which reads
 * as a layout bug rather than as "not applicable" — and `value || "—"` is
 * worse, because it turns a legitimate 0 (a duck, a maiden) into a dash. Only
 * null and undefined become the dash.
 */
const stat = (v, suffix = "") => (v === null || v === undefined ? "—" : `${v}${suffix}`);

export { addDays, dateStr, fitnessColor, initials, pctDays, roleColor, severityColor, stat, today };
