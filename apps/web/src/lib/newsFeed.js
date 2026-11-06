/**
 * THE NEWSFEED'S WORDS AND ORDER — pure, and small enough for the public
 * bundle (home/sections/News.jsx draws the same cards).
 *
 * WHAT IT DECIDES: how a post the reader already has is presented. Never
 * which posts: the policy on news_post decided that before the rows arrived
 * (db/12, db/96, db/101), and the public copy (db/83) before the home page's.
 * Nothing here filters for permission; the chips narrow what is on screen.
 *
 *   hashOf(s)            a stable 32-bit hash: a cover is the same every time
 *   sideLabel(code)      "1XI" → "1st XI"; any other code as written
 *   kickerOf(post)       "1st XI · Westville", "Whole school · Westville", "League · Inland T20"
 *   standfirst(body)     the opening of the body, two or three lines' worth
 *   paragraphs(body)     the whole body as paragraphs, text only
 *   deskOf(post)         who wrote it, by the desk that may post to that audience — never an email
 *   whenSa(at, now)      "Today, 14:30", "Yesterday, 09:10", "Thu 5 Nov", "12 Oct 2025", on the SA clock
 *   bandOf(at, now)      "today" | "week" | "earlier", by the SA day
 *   readStore(viewer)    which posts this viewer has opened, in this browser only
 */
import { saClock, saDate } from "./saTime.js";

/** FNV-1a, 32 bits. @param {unknown} s */
export function hashOf(s) {
  let h = 0x811c9dc5;
  const str = String(s ?? "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const ORD = (n) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" })[n % 10] ?? "th"}`;
};

/** "1XI" → "1st XI", "2xi" → "2nd XI"; "U15A" and anything else as written. @param {unknown} code */
export function sideLabel(code) {
  const c = String(code ?? "").trim();
  const m = /^(\d{1,2})\s*XI$/i.exec(c);
  return m ? `${ORD(Number(m[1]))} XI` : c;
}

/**
 * The line over the headline: the audience, then where.
 * @param {{ scope?: string, teamCode?: string | null, audience?: string, schoolName?: string | null, competitionName?: string | null }} p
 */
export function kickerOf(p) {
  if (p.scope === "team") return [sideLabel(p.teamCode || p.audience || "Side"), p.schoolName].filter(Boolean).join(" · ");
  if (p.scope === "school") return ["Whole school", p.schoolName || p.audience].filter(Boolean).join(" · ");
  if (p.scope === "competition") return ["League", p.competitionName || p.audience].filter(Boolean).join(" · ");
  return p.audience || "";
}

/** The body as paragraphs: split on blank lines, each kept as written. @param {unknown} body */
export function paragraphs(body) {
  return String(body ?? "").replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * The opening of the body, for the card: whole sentences where they fit, cut
 * at a word with an ellipsis where they do not. The card clamps it to three
 * lines as well, so this only keeps the DOM short.
 * @param {unknown} body @param {number} [max]
 */
export function standfirst(body, max = 220) {
  const flat = String(body ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (stop > max * 0.55) return cut.slice(0, stop + 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/**
 * Who wrote it. A plan's author is named to every reader of the plan (db/103);
 * an ordinary post's author is named only where the reader may read the
 * author's account. Otherwise, and whenever the name would be an email
 * address, the desk that may post to this audience: a team post is the side's
 * staff, a school post the school's, a league post the league's.
 * @param {{ scope?: string, teamCode?: string | null, schoolName?: string | null, competitionName?: string | null, authorName?: string | null }} p
 */
export function deskOf(p) {
  const name = typeof p.authorName === "string" ? p.authorName.trim() : "";
  const desk = p.scope === "team" ? `${sideLabel(p.teamCode) || "Team"} staff`
    : p.scope === "school" ? `${p.schoolName || "School"} staff`
    : p.scope === "competition" ? `${p.competitionName || "League"} organisers`
    : "The office";
  if (name && !name.includes("@")) return { name, desk };
  return { name: null, desk };
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayNumber = (/** @type {string} */ ymd) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 864e5);

/** Days between the SA day of `at` and the SA day of `now`; null without a day. */
function daysAgo(at, now) {
  const a = saDate(at), b = saDate(now);
  return a && b ? dayNumber(b) - dayNumber(a) : null;
}

/** "today" | "week" | "earlier" by the SA day. @param {unknown} at @param {unknown} [now] */
export function bandOf(at, now = Date.now()) {
  const d = daysAgo(at, now);
  if (d == null) return "earlier";
  if (d <= 0) return "today";
  if (d < 7) return "week";
  return "earlier";
}

export const BAND_LABEL = Object.freeze({ today: "Today", week: "This week", earlier: "Earlier" });

/** When, on the SA clock, in the fewest words. @param {unknown} at @param {unknown} [now] */
export function whenSa(at, now = Date.now()) {
  const day = saDate(at);
  if (!day) return "";
  const clock = saClock(at);
  const d = daysAgo(at, now);
  const [y, m, dd] = day.split("-").map(Number);
  const wd = WEEKDAY[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  if (d === 0) return clock ? `Today, ${clock}` : "Today";
  if (d === 1) return clock ? `Yesterday, ${clock}` : "Yesterday";
  const nowYear = Number(String(saDate(now)).slice(0, 4));
  if (d != null && d > 1 && d < 7) return `${wd} ${dd} ${MONTH[m - 1]}`;
  return y === nowYear ? `${dd} ${MONTH[m - 1]}` : `${dd} ${MONTH[m - 1]} ${y}`;
}

/** The full date and time for the article's byline: "Thursday 5 November 2026, 14:30". */
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** @param {unknown} at */
export function longWhenSa(at) {
  const day = saDate(at);
  if (!day) return "";
  const [y, m, dd] = day.split("-").map(Number);
  const wd = WEEKDAY_LONG[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  const clock = saClock(at);
  return `${wd} ${dd} ${MONTH_LONG[m - 1]} ${y}${clock ? `, ${clock}` : ""}`;
}

/**
 * Which posts this viewer has opened, kept in this browser only (a
 * convenience, never a record: it is not sent anywhere, and a private window
 * or cleared storage simply shows everything as new again). Every read and
 * write is in try/catch: storage that throws is storage that is not there.
 * @param {string} viewer a key for whoever is signed in on this browser
 * @param {Storage | null} [store]
 */
export function readStore(viewer, store) {
  const key = `scrbrd.news.opened.v1:${viewer || "anon"}`;
  const s = store !== undefined ? store : (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();
  const load = () => {
    try {
      const raw = s?.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
    } catch { return new Set(); }
  };
  const save = (/** @type {Set<string>} */ set) => {
    try { s?.setItem(key, JSON.stringify([...set].slice(-400))); } catch { /* storage full or blocked: unread marks are a convenience */ }
  };
  return {
    load,
    /** @param {string[]} ids */
    mark(ids) { const set = load(); for (const id of ids) { set.delete(id); set.add(id); } save(set); return set; },
  };
}
