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

// ── HUMAN DATES (DESIGN_DIRECTION §3, §5) ──
// "2026-09-26" reads as a row in a spreadsheet; a person reads "Sat 26 Sep".
// Built from a fixed table rather than toLocaleDateString(): Intl's "short"
// month for en-ZA and en-GB both come back "Sept" (four letters), and the
// brief's own wording is the three-letter form. Parsed as UTC midnight, the
// same convention asMatch() already keeps for `date` — a fixture's day never
// rolls backward for a reader west of Greenwich.
const WEEKDAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTH_SHORT   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** "2026-09-26" → "Sat 26 Sep". An absent or unparsable date is an em dash, never blank. */
const humanDate = (isoDate) => {
  if (!isoDate) return "—";
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return `${WEEKDAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
};

/** "2026-09-26", "10:00" → "Sat 26 Sep · 10:00". No time: just the day. */
const humanDateTime = (isoDate, time) => {
  const day = humanDate(isoDate);
  return time ? `${day} · ${time}` : day;
};

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

/**
 * A field the reader is not cleared for.
 *
 * Masked columns arrive as null — the database decided, per row, that this
 * person may not have them — and rendering null puts a blank where a value
 * goes. A blank reads as missing data: the coach thinks nobody has recorded
 * the diagnosis and goes looking for the physio, when in fact it is recorded
 * and simply not theirs to read.
 *
 * So a withheld field says so. This is not a security control — the value is
 * already absent by the time it reaches the browser, and nothing here could
 * put it back — it is honesty about WHY the space is empty.
 */
const withheld = (v, label = "Not shown at your access level") =>
  (v === null || v === undefined ? label : v);

export { addDays, dateStr, fitnessColor, humanDate, humanDateTime, initials, pctDays, roleColor, severityColor, stat, today, withheld };
