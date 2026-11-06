/**
 * The captain's Player of the Match nomination: the words (RECOGNITION R7,
 * docs/design/RECOGNITION_design.md D17, D18, §7 "the captain" and "the
 * coach"; db/144).
 *
 * The server decides every rule and words every refusal (nomination-api.mjs
 * CAPTAIN_WORDS, NOMINATION_WORDS). This holds the two screens' own
 * sentences, so the Captain tab, the staff sheet, the To-resolve row and
 * their tests read one copy. Pure: no DOM, no clock (the caller passes `now`).
 *
 * What the captain is never told (§7): "rejected", "declined", "overruled",
 * the coach's reason, an opposition name as a nominee, whether the coach
 * "followed" him. Each outcome is said in neutral words: "With Mr Dlamini.",
 * "Player of the Match: K Naidoo · the coach decided", "No award for this
 * match.", "The window closed on Monday."
 */
import { potmShortName } from "./potm.js";

const TZ_MS = 2 * 3600 * 1000;   // Africa/Johannesburg: UTC+2, no daylight saving
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sa = (/** @type {number} */ ms) => new Date(ms + TZ_MS);
const msOf = (/** @type {string | number | null | undefined} */ at) => (typeof at === "number" ? at : at ? Date.parse(at) : NaN);

/**
 * "Sat 20:14", the fixture's time zone; a date is added once it is more than
 * six days from `now` ("Sat 3 Oct 20:14").
 * @param {string | number | null | undefined} at @param {number} now
 */
export function dayTime(at, now) {
  const ms = msOf(at);
  if (!Number.isFinite(ms)) return null;
  const d = sa(ms);
  const far = Math.abs(ms - now) > 6 * 86400000;
  return `${DAYS[d.getUTCDay()]}${far ? ` ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : ""} ${d.toISOString().slice(11, 16)}`;
}

/** "Monday", for "The window closed on Monday." @param {string | number | null | undefined} at */
export function dayName(at) {
  const ms = msOf(at);
  return Number.isFinite(ms) ? DAY_NAMES[sa(ms).getUTCDay()] : null;
}

/** Who nominated, as a role word (staff read the role, not the boy's name, on the line). @param {string | null | undefined} as */
export const nominatorWord = (as) => (as === "vice_captain" ? "the vice-captain" : "the captain");

/**
 * The Captain tab's lead (D17): "Nominate one team-mate. Mr Dlamini decides.
 * You cannot choose yourself."
 * @param {string | null | undefined} coachName
 */
export const captainLead = (coachName) =>
  `Nominate one team-mate. ${coachName ? `${coachName} decides.` : "Your coach decides."} You cannot choose yourself.`;

/** The one tap's label. @param {string | null | undefined} name */
export const nominateLabel = (name) => (name ? `Nominate ${potmShortName(name)}` : "Choose a team-mate first");

/** The confirm sheet's sentence. @param {string} name @param {string | null | undefined} coachName */
export const nominateConfirmWords = (name, coachName) =>
  `This sends ${potmShortName(name)} to ${coachName ?? "your coach"} as your nomination. ${coachName ? "He decides" : "The coach decides"}, and the side hears it from him.`;

/**
 * His own nomination's state, in neutral words (D17's sketch): one to three
 * lines, never a verdict word.
 * @param {{nomineeName: string, status: string, nominatedAt?: string | null, decidedAt?: string | null,
 *          closesAt?: string | null, award?: {name: string, awardedAt?: string | null, same?: boolean} | null} | null} mine
 * @param {string | null | undefined} coachName
 * @param {number} now
 * @returns {string[]}
 */
export function mineWords(mine, coachName, now) {
  if (!mine) return [];
  const when = dayTime(mine.nominatedAt, now);
  const lines = [`You nominated ${mine.nomineeName}${when ? ` · ${when}` : ""}`];
  switch (mine.status) {
    case "open":
      lines.push(coachName ? `With ${coachName}.` : "With the coach.");
      break;
    case "confirmed": {
      const day = mine.award?.awardedAt ? dayTime(mine.award.awardedAt, now)?.split(" ")[0] : null;
      if (mine.award) lines.push(`Player of the Match: ${mine.award.name}${day ? ` · ${day}` : ""}`);
      break;
    }
    case "superseded":
      if (mine.award) lines.push(`Player of the Match: ${mine.award.name} · the coach decided`);
      break;
    case "no_award":
      lines.push("No award for this match.");
      break;
    case "lapsed": {
      const day = dayName(mine.closesAt ?? mine.decidedAt);
      lines.push(day ? `The window closed on ${day}.` : "The window closed.");
      break;
    }
    default:
      break;
  }
  return lines;
}

/**
 * The staff sheet's line (D18): "The captain nominated R Pillay · decide by
 * Mon 20:14".
 * @param {{nomineeName: string, nominatedAs?: string | null, closesAt?: string | null}} n @param {number} now
 */
export function staffLine(n, now) {
  const by = dayTime(n.closesAt, now);
  const who = nominatorWord(n.nominatedAs);
  return `${who[0].toUpperCase()}${who.slice(1)} nominated ${potmShortName(n.nomineeName)}${by ? ` · decide by ${by}` : ""}`;
}

/** The no-award confirm sheet's sentence. */
export const NO_AWARD_WORDS = "This records no Player of the Match for this side. The side is not told; the captain's tab says there is no award.";

/** What a no-award decision reads as on the staff sheet afterwards. */
export const NO_AWARD_DONE = "No award recorded on the captain's nomination.";

/**
 * The To-resolve rows (D18, A22): one per open nomination the reader may
 * decide, "Player of the Match to decide · the captain nominated R Pillay ·
 * by Mon 20:14", with its one door to the fixture. The read decides who sees
 * a row (db/144 nominations_to_decide()).
 * `rows` is the read's answer, `null` a read that failed.
 * @param {{rows: any[] | null, now: number, error?: string | null}} o
 */
export function nominationRows({ rows, now, error = null }) {
  if (rows == null) {
    return { rows: [], unread: [{ id: "potm:read", rule: "read", state: /** @type {const} */ ("could_not_read"), read: "potm",
      fact: "Could not read the nominations to decide", count: 0, source: null, owner: null, deadline: null, age: null,
      action: { kind: "retry", label: "Try again" }, error }], open: 0, failed: 1 };
  }
  const out = rows.map((r) => {
    const closes = msOf(r.closesAt);
    const by = dayTime(r.closesAt, now);
    return {
      id: `potm:${r.nominationId}`, rule: "P1", state: /** @type {const} */ ("open"), count: 1,
      fact: `Player of the Match to decide · ${nominatorWord(r.nominatedAs)} nominated ${r.nomineeName}`,
      source: "the captain's nomination", owner: "you",
      deadline: Number.isFinite(closes) ? { clock: "record", at: closes, due: closes < now, words: `by ${by}` } : null,
      age: null,
      action: { kind: "result", label: "Decide it", matchId: r.matchId },
    };
  });
  return { rows: out, unread: [], open: out.length, failed: 0 };
}
