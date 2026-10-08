/**
 * THE PARENT'S ACTION LIST, PHASES A0 AND A1 (docs/design/GA-I20_parent_action_list.md
 * §2, §3, §4, §6, §7): "To do for Rohan", drawn from the reads the family
 * app already makes, in the staff queue's shape (lib/queue.js): a row is a
 * fact the server can prove, with a source, a by-when and one door; it is
 * worked out again every time the screen opens, never marked done and never
 * stored on the device.
 *
 * THE RULES (§2.3):
 *
 *   R1  an answer is owed for a fixture: his row in the fixture's answers
 *       says nothing (`status` null; silence is not a yes).
 *   R2  answer again: the fixture moved since the answer was given, and the
 *       server says so (`needs_reconfirming`, db/65).
 *   R3  his seat on a lift waits on a guardian's yes again (`awaiting_guardian`).
 *   R4  his seat is still only asked for inside 48 hours of meeting.
 *   R5  families have asked for a seat on HER lift (a count, N3; no name).
 *   R6  the fixture moved under HER lift and she has not stood behind it again.
 *   R7  on the day: the driver says he was handed over, or the car home has
 *       left, and nobody has said he is with his family yet.
 *   R8a the school's terms are not agreed on her own link.
 *   R8b his name on public pages: she has not answered.
 *   R8c health monitoring is in use at his school and not answered.
 *   R9  no number is on record to ring if he is hurt (a count, N2).
 *
 * THE PUPIL (`self`, D12): the same module. Under eighteen his answer rows
 * only (R1, R2); a consent row only where the server says the answer is his
 * to give (`canSayYes` on his own row, `ask_at_18`). He is never shown a
 * contact row, and his own lifts stay on his own lift line (Q5). The client
 * computes no age: every "is he eighteen" is the server's word.
 *
 * THE RULES ARE HONEST ABOUT A READ THAT DID NOT ANSWER (I08). `null` is a read
 * that failed and makes a "Could not read …" row and a "· 1 read failed" in the
 * count; `[]` is a read that answered with nothing and says nothing; a read not
 * made yet is `undefined` and the count says "Reading…"; OFF is a source that
 * does not apply (a module switched off, a reader it is not for) and says
 * nothing at all. "Nothing to do for Rohan" is said only when every read
 * answered and no rule fired.
 *
 * HIS ROWS AND NOBODY'S (D11). A coach who is a parent reads her whole side's
 * answers; `his()` cuts every read to the one child's own rows before a rule
 * is run, so a rule never counts, and a row never names, another boy. The only
 * place this file reads a `playerId` is there.
 *
 * What it never says (design §4.4): no reason and no note of an answer, no
 * other child's name, no number to ring, and no "done", "ready" or percentage.
 * Counts, the names of reads, the fixture and the adult who drives only;
 * apps/web/test/todo.test.mjs holds the source to it.
 *
 * Pure, so it is proved under plain node: no React, no DOM, no database and
 * no clock (the caller passes `now`).
 */
import { fixturesOf, isTheirs, longDate, opponentOf } from "./family.js";
import { startMs } from "./cockpit.js";
import { couldNotRead, readsFailed } from "./readState.js";

/** How far ahead the list looks, in days (design D4); later fixtures fold. */
export const WINDOW_DAYS = 14;
/** The list's clock for an answer: this many hours before the start (D3, the feed's `isSoon`). */
export const CLOCK_HOURS = 48;
/** A seat still only asked for becomes hers to decide about this close to meeting (R4, Q3). */
export const SEAT_HOURS = 48;
/** The handover's clock: thirty minutes from the driver's mark (db/76 D14). */
export const HANDOVER_MINUTES = 30;
/** The day's read covers a fixture this close to now, either way (lifts.jsx `inLiftDay`). */
export const DAY_HOURS = 36;
/** The link-ending line shows this many days before the end (§3.6). */
export const ENDING_DAYS = 30;

/** A source that does not apply to this reader, or whose module is off: no row, no line. */
export const OFF = "off";

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The South African clock (UTC+2, no summer time): "Sat" and "Thu 07:00". @param {number} ms */
const sa = (ms) => new Date(ms + 2 * HOUR);
const dayShort = (/** @type {number} */ ms) => WEEKDAY[sa(ms).getUTCDay()];
const hhmm = (/** @type {number} */ ms) => sa(ms).toISOString().slice(11, 16);
const clockWords = (/** @type {number} */ ms) => `${dayShort(ms)} ${hhmm(ms)}`;
const msOf = (/** @type {any} */ v) => { const t = Date.parse(v ?? ""); return Number.isFinite(t) ? t : null; };
/** "14 Jan 2026 14:02", on the South African clock, from a timestamp the server recorded. */
const stamp = (/** @type {any} */ v) => { const t = msOf(v); return t == null ? null : `${longDate(sa(t).toISOString())} ${hhmm(t)}`; };

/**
 * "To do for Rohan": the name the family uses for him, as the screen says it
 * (`knownAs`, else the name on the record).
 * @param {{knownAs?: string | null, name?: string | null}} child
 */
export function firstNameOf(child) {
  return String(child?.knownAs || child?.name || "").trim();
}

/**
 * Is this row about the one child, and no other? Every read's rows pass
 * through here before a rule sees them (D11).
 * @param {any} r  @param {{id: string}} child
 */
const his = (r, child) => r != null && r.playerId === child.id;

/**
 * His own row out of one fixture's answers, and no other. The read's rows may
 * be a whole side's (a coach reads the side); only the child's are kept, and
 * the first of those, so one boy is one row per fixture however many came back.
 * @param {any[]} rows  @param {{id: string}} child
 */
const narrow = (rows, child) => rows.find((r) => his(r, child)) ?? null;

/**
 * Which rule, if any, his row fires. Only a silent row (R1) or one the server
 * says to answer again (R2): every status that was set, whoever set it, is an
 * answer.
 * @param {{status?: string | null, needsReconfirming?: boolean} | null} row
 * @returns {"R1" | "R2" | null}
 */
export function ruleOf(row) {
  if (!row) return null;                       // not on the roster this read returned: not provable, so not said
  if (row.status === "needs_reconfirming" || row.needsReconfirming === true) return "R2";
  if (row.status == null) return "R1";
  return null;
}

/** The fixture in its own words: "Sat v Kearsney". */
const fixtureWords = (/** @type {any} */ m, /** @type {any} */ child) => {
  const t = startMs(m);
  return `${t == null ? "" : `${dayShort(t)} `}v ${opponentOf(m, child)}`;
};
const legWords = (/** @type {string} */ leg) => (leg === "back" ? "home" : "there");

/**
 * By-when, the list's own clock, labelled as such: a time, or "due now" once
 * it has come. Never a time in the past.
 * @param {number | null} clock  @param {number} now
 */
const byWhen = (clock, now) => (clock == null ? null : clock <= now ? "due now" : `by ${clockWords(clock)}`);

/**
 * One open row. `o` carries the rule's own words and door; everything else is
 * the row's shape (§2.2).
 * @param {{rule: string, key: string, child: any, matchId?: string | null, fact: string, owner: string,
 *          clock?: number | null, byWhenText?: string | null, source: string, sourceText: string,
 *          door: {kind: string, label: string, matchId?: string, offerId?: string, seatId?: string}, at?: number | null}} o
 * @param {number} now
 */
function row(o, now) {
  const clock = o.clock ?? null;
  return {
    id: `${o.rule}:${o.key}`,
    rule: o.rule,
    state: /** @type {"open"} */ ("open"),
    matchId: o.matchId ?? null,
    childId: /** @type {string} */ (o.child.id),
    fact: o.fact,
    owner: o.owner,
    byWhen: clock,
    byWhenText: o.byWhenText !== undefined ? o.byWhenText : byWhen(clock, now),
    clockLabel: "the list's clock",
    source: o.source,
    sourceText: o.sourceText,
    door: o.door,
    at: o.at ?? null,
  };
}

/**
 * A read that did not answer, as a row in its place: "Could not read the
 * answers for Sat v Kearsney", with the one door of trying again.
 * @param {string} key  @param {string} label  @param {string | null} matchId  @param {boolean} [retry]
 */
function unreadRow(key, label, matchId, retry = matchId != null) {
  return {
    id: `unread:${key}`,
    rule: null,
    state: /** @type {"could_not_read"} */ ("could_not_read"),
    matchId,
    key,
    label,
    fact: couldNotRead(label),
    source: key.split(":")[0],
    door: retry ? { kind: /** @type {"retry"} */ ("retry"), matchId, label: "Try again" } : null,
  };
}

/** Whether a source was asked for at all (a key present in the call), and what it said. */
const sourceOf = (/** @type {any} */ o, /** @type {string} */ k) =>
  !Object.hasOwn(o, k) || o[k] === OFF ? { off: true } : { off: false, value: o[k] };

/** The rows of the dated rules, for one fixture's lifts read (R3, R4, R6). */
function liftRows(offers, m, child, now, self) {
  const first = firstNameOf(child);
  const out = [];
  for (const o of offers) {
    // Her own lift on HIS side (an offer on the other end of a shared fixture is another side's).
    const onHisSide = o.schoolId == null || (o.schoolId === child.school && (o.team == null || o.team === child.team));
    const meet = msOf(o.meetAt);
    if (!self && o.mine && o.awaitingDriver && onHisSide) {
      out.push(row({ rule: "R6", key: o.id, child, matchId: m.id, clock: meet, at: meet,
        fact: `${fixtureWords(m, child)} moved. Do you still offer the lift ${legWords(o.leg)}?`,
        owner: "you, as the driver", source: "lifts", sourceText: "from the fixture's lifts",
        door: { kind: "fixture", matchId: m.id, label: "Lifts" } }, now));
    }
    for (const s of (o.mySeats ?? []).filter((x) => his(x, child))) {
      const driver = o.driverName ? ` with ${o.driverName}` : "";
      const name = self ? "Your" : `${first}'s`;
      if (s.status === "awaiting_guardian") {
        out.push(row({ rule: "R3", key: s.seatId, child, matchId: m.id, clock: meet, at: meet,
          fact: `${name} seat${driver} ${legWords(o.leg)} for ${fixtureWords(m, child)}: confirm again`,
          owner: self ? "you" : `you or ${first}'s other parent`, source: "lifts", sourceText: "from the fixture's lifts",
          door: { kind: "fixture", matchId: m.id, label: "Lifts" } }, now));
      } else if (s.status === "requested" && meet != null && meet > now && meet - now <= SEAT_HOURS * HOUR) {
        out.push(row({ rule: "R4", key: s.seatId, child, matchId: m.id, clock: meet, at: meet,
          fact: `${name} seat ${legWords(o.leg)} for ${fixtureWords(m, child)} is not confirmed; the driver has not answered`,
          owner: "you", source: "lifts", sourceText: "from the fixture's lifts",
          door: { kind: "fixture", matchId: m.id, label: "Lifts" } }, now));
      }
    }
  }
  return out;
}

/** R7, from the day's own read: the way home, handed over or left, and nobody has said he is home. */
function dayRows(cards, m, child, now) {
  const first = firstNameOf(child);
  const out = [];
  for (const e of cards) {
    if (e.as !== "family" || e.leg !== "back") continue;
    for (const s of (e.seats ?? []).filter((x) => his(x, child))) {
      if (!s.mayReceive || s.acknowledgedAt || s.resolvedAt) continue;
      const handed = msOf(s.handedOverAt);
      if (handed == null && !e.departedAt) continue;
      const driver = e.driverName || "The driver";
      out.push(row({ rule: "R7", key: s.seatId, child, matchId: m.id,
        clock: handed == null ? null : handed + HANDOVER_MINUTES * 60e3, at: handed ?? msOf(e.departedAt),
        fact: handed != null ? `${driver} says ${first} was handed over at ${hhmm(handed)}. Confirm.`
          : `${first}'s lift home with ${e.driverName || "the driver"} has left. Confirm when ${first} is with you.`,
        owner: `you or ${first}'s other parent`, source: "lifts_day", sourceText: "from today's lift",
        door: { kind: "day", matchId: m.id, offerId: e.offerId, seatId: s.seatId, label: "Confirm collected" } }, now));
    }
  }
  return out;
}

/**
 * The list for ONE child.
 *
 * `matches` is the fixtures read (the Match Centre's rows): `undefined` while it
 * is being made, `null` if it failed. `answers` is each fixture's availability
 * read, keyed by the fixture's id: a missing key is a read not made yet, `null`
 * a failed one, an array (even empty) an answered one. `lifts` (each fixture's
 * lifts) and `day` (the day's lift cards, for `dayFixtures()` only) are keyed
 * the same way. `requests` (N3), `consents`, `publicName` and `contacts` (N2)
 * are one read each. Any source left out of the call, or passed as OFF, does
 * not apply and says nothing.
 *
 * `rows` are the ones inside the window: the dated ones nearest first, then
 * the undated ones in the fixed order R8a, R8b, R8c, R9 (§2.5), each "could not
 * read" row in the place of the read that failed. `later` is every open row
 * beyond the window, folded. `open` counts open rows inside the window and
 * nothing else: a read that failed is not a zero, and a later fixture is not
 * today's to do.
 *
 * @param {{child: any, matches: any[] | null | undefined, answers?: Record<string, any[] | null | undefined>, now: number,
 *          self?: boolean, lifts?: Record<string, any[] | null | undefined> | "off",
 *          day?: Record<string, any[] | null | undefined> | "off", requests?: any[] | null | undefined | "off",
 *          consents?: any[] | null | undefined | "off", publicName?: any, contacts?: any[] | null | undefined | "off"}} o
 */
export function todoOf(o) {
  const { child, matches, answers = {}, now, self = false } = o;
  const first = firstNameOf(child);
  /** @type {any[]} */
  const dated = [];
  /** @type {any[]} */
  const undated = [];
  /** @type {any[]} */
  const later = [];
  let reading = false;
  const horizon = now + WINDOW_DAYS * DAY;
  const place = (/** @type {any} */ r) => { if ((r.at ?? 0) <= horizon) dated.push(r); else later.push(r); };

  const lifts = self ? { off: true } : sourceOf(o, "lifts");
  const day = self ? { off: true } : sourceOf(o, "day");
  const requests = self ? { off: true } : sourceOf(o, "requests");

  let upcoming = /** @type {any[]} */ ([]);
  if (matches === undefined) reading = true;
  else if (matches === null) dated.push(unreadRow("matches", "the fixtures", null));
  else {
    upcoming = fixturesOf(matches, child, now).upcoming;
    for (const m of upcoming) {
      // R1, R2: his row in the fixture's answers.
      const read = answers?.[m.id];
      if (read === undefined) reading = true;
      else if (read === null) dated.push(unreadRow(`availability:${m.id}`, `the answers for ${fixtureWords(m, child)}`, m.id));
      else {
        const rule = ruleOf(narrow(read, child));
        if (rule) {
          const start = startMs(m);
          place(row({ rule, key: m.id, child, matchId: m.id, at: start,
            clock: start == null ? null : start - CLOCK_HOURS * HOUR,
            fact: rule === "R1" ? `Answer for ${fixtureWords(m, child)}` : `${fixtureWords(m, child)} moved: say again`,
            owner: self ? "you or your parents" : `you or ${first}`, source: "availability", sourceText: "from the fixture's answers",
            door: { kind: "fixture", matchId: m.id, label: rule === "R1" ? "Answer" : "Say again" } }, now));
        }
      }
      // R3, R4, R6: the fixture's lifts.
      if (!lifts.off) {
        const l = lifts.value?.[m.id];
        if (l === undefined) reading = true;
        else if (l === null) dated.push(unreadRow(`lifts:${m.id}`, `the lifts for ${fixtureWords(m, child)}`, m.id));
        else if (l !== OFF) liftRows(l, m, child, now, self).forEach(place);
      }
    }
    // R7: the day's cards, read on the day only.
    if (!day.off) {
      for (const m of dayFixtures(matches, child, now)) {
        const d = day.value?.[m.id];
        if (d === undefined) reading = true;
        else if (d === null) dated.push(unreadRow(`lifts_day:${m.id}`, `today's lifts for ${fixtureWords(m, child)}`, m.id));
        else if (d !== OFF) dayRows(d, m, child, now).forEach(place);
      }
    }
    // R5: requests on her own open lifts to his side's fixtures still to come. A count, no name.
    if (!requests.off) {
      const r = requests.value;
      if (r === undefined) reading = true;
      else if (r === null) dated.push(unreadRow("requests", "the requests on your lifts", null, true));
      else {
        for (const q of r) {
          const m = upcoming.find((x) => x.id === q.matchId);
          if (!m || !(q.requested > 0) || (q.schoolId != null && q.schoolId !== child.school) || (q.team != null && q.team !== child.team)) continue;
          const meet = msOf(q.meetAt);
          place(row({ rule: "R5", key: q.offerId, child, matchId: m.id, clock: meet, at: meet,
            fact: `${q.requested} ${q.requested === 1 ? "request" : "requests"} for a seat on your lift ${legWords(q.leg)} for ${fixtureWords(m, child)}`,
            owner: "you, as the driver", source: "lift_requests", sourceText: "from your lifts",
            door: { kind: "fixture", matchId: m.id, label: "Lifts" } }, now));
        }
      }
    }
  }

  // The undated rows, after the dated ones, in the design's fixed order.
  const next = upcoming[0] ?? null;
  const nextStart = next ? startMs(next) : null;
  // R8a: the terms, on her own link (never the pupil's: his self link is not a guardian's).
  if (!self && child.consent && child.consent !== "granted") {
    undated.push(row({ rule: "R8a", key: child.id, child,
      fact: child.consent === "withdrawn" && child.consentAt
        ? `You withdrew the school's terms for ${first} on ${longDate(child.consentAt)}. Lifts and health monitoring are off until they are agreed again.`
        : `The school's terms for ${first} are not agreed yet. The office will ask you.`,
      owner: "you (your own agreement)", byWhenText: child.from ? `since ${longDate(child.from)}` : null,
      source: "my_children", sourceText: "from your link to the school", door: { kind: "consents", label: "Consents" } }, now));
  }
  // The consents read answers for him, and says whether he is an adult (db/62): the server's word, never an age here.
  const consents = sourceOf(o, "consents");
  const mineConsent = !consents.off && Array.isArray(consents.value)
    ? consents.value.find((c) => his(c, child) && c.kind !== "passport" && (self ? c.relation === "self" : c.relation !== "self")) ?? null : null;
  const adult = !self && mineConsent?.adult === true;
  // R8b: his name on public pages, her own answer (`mine`). 404 for a reader who answers for nobody: no row.
  const pn = sourceOf(o, "publicName");
  if (!pn.off && !self && !adult) {
    if (pn.value === undefined) reading = true;
    else if (pn.value === null) undated.push(unreadRow("public_name", "the answer about public pages", null, true));
    else {
      const mine = pn.value?.mine;
      if (mine && (mine.state === "not_answered" || mine.state === "superseded")) {
        undated.push(row({ rule: "R8b", key: child.id, child,
          fact: `Not answered: ${first} is shown as "Batter" or "Bowler" on public pages until someone answers`,
          owner: `you or ${first}'s other parent`, source: "public_name", sourceText: "from the public-pages answer",
          door: { kind: "consents", label: "Consents" } }, now));
      }
    }
  }
  // R8c: health monitoring, only where his school runs it and the server says the answer may be given.
  if (!consents.off) {
    if (consents.value === undefined) reading = true;
    else if (consents.value === null) undated.push(unreadRow("consents", "the consents", null, true));
    else if (mineConsent && mineConsent.moduleOn !== false && mineConsent.canSayYes === true
             && (mineConsent.state === "not_answered" || (self && mineConsent.askAt18 === true))) {
      undated.push(row({ rule: "R8c", key: child.id, child,
        fact: !self ? `Health monitoring for ${first}: not answered, and ${child.schoolName || "the school"} runs it`
          : mineConsent.askAt18 === true ? "Health monitoring: your parents said yes. From your eighteenth birthday it is yours to answer"
          : "Health monitoring: not answered. It is yours to answer",
        owner: self ? "you" : `you or ${first}'s other parent`, source: "consents", sourceText: "from the consents",
        door: { kind: "consents", label: "Consents" } }, now));
    }
  }
  // R9: a count of live numbers, never a contact. Never for the pupil (STEP4 Q7).
  const contacts = self ? { off: true } : sourceOf(o, "contacts");
  if (!contacts.off) {
    if (contacts.value === undefined) reading = true;
    else if (contacts.value === null) undated.push(unreadRow("emergency_contact_count", "the numbers on record", null, true));
    else {
      const c = contacts.value.find((x) => his(x, child));
      if (c && c.active === 0) {
        undated.push(row({ rule: "R9", key: child.id, child, clock: nextStart,
          byWhenText: nextStart == null ? null : nextStart <= now ? "due now" : `before ${dayShort(nextStart)}`,
          fact: `No number is on record to ring if ${first} is hurt`,
          owner: "you", source: "emergency_contact_count", sourceText: "from the numbers on record",
          door: { kind: "ring", label: "Who to ring" } }, now));
      }
    }
  }

  dated.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
  later.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
  const ORDER = ["R8a", "R8b", "R8c", "R9"];
  undated.sort((a, b) => (a.rule ? ORDER.indexOf(a.rule) : 9) - (b.rule ? ORDER.indexOf(b.rule) : 9));
  const rows = [...dated, ...undated];

  const open = rows.filter((r) => r.state === "open").length;
  const unread = rows.length - open;
  const clear = !reading && open === 0 && unread === 0 && later.length === 0;
  const who = self ? "you" : first;
  const line = reading ? "Reading…"
    : clear ? `Nothing to do for ${who}`
    : open === 0 && unread === 0 ? `Nothing to do for ${who} in the next ${WINDOW_DAYS} days`
    : `${open} to do${unread ? ` · ${readsFailed(unread)}` : ""}`;
  return {
    childId: child.id,
    label: self ? "To do for you" : `To do for ${first}`,
    rows,
    open,
    unread,
    reading,
    clear,
    line,
    later: { rows: later, line: later.length ? `Later · ${later.length} to answer` : null },
    /** Whether any open row carries the list's clock, so the card can say what the clock is. */
    clocked: rows.some((r) => r.state === "open" && r.byWhenText && r.byWhen != null) || later.some((r) => r.byWhenText),
    clockWords: `By-when is ${CLOCK_HOURS} hours before the start.`
      + ([...rows, ...later].some((r) => ["R3", "R4", "R5", "R6"].includes(r.rule)) ? " For a lift, it is the meeting time." : "")
      + ([...rows, ...later].some((r) => r.rule === "R7") ? ` For a handover, ${HANDOVER_MINUTES} minutes after it.` : ""),
  };
}

/**
 * The fixtures whose answers (and lifts) the list must read for this child:
 * every one of his side's still to come. The same set the Matches screen
 * already reads one answer for, per row.
 * @param {any[] | null | undefined} matches  @param {any} child  @param {number} now
 */
export function fixturesToRead(matches, child, now) {
  return (Array.isArray(matches) ? fixturesOf(matches, child, now).upcoming : []).map((m) => m.id);
}

/**
 * The fixtures whose day the list must read (R7): his side's, whatever their
 * status, starting within a day and a half of now either way, as the day
 * cards are read (lifts.jsx `inLiftDay`). The way home is after the match.
 * @param {any[] | null | undefined} matches  @param {any} child  @param {number} now
 */
export function dayFixtures(matches, child, now) {
  return (Array.isArray(matches) ? matches : []).filter((m) => {
    const t = startMs(m);
    return isTheirs(m, child) && t != null && Math.abs(t - now) < DAY_HOURS * HOUR;
  });
}

/**
 * "Rohan · 2 to do": the count each child's card on Family carries (D1, D10),
 * one child's own, never a sum. The same words the list's count line says.
 * @param {ReturnType<typeof todoOf>} t
 */
export const countWords = (t) => t.line;

/** Who gave a record, in the server's own words, naming nobody (§3.1, §4.4). */
function giverWords(/** @type {any} */ a) {
  if (a.actor === "you" || a.byYou === true) return "you";
  if (a.fromForm) return "the office, from a signed form";
  if (a.actor === "office") return "the office, on the family's word";
  return "the guardian";
}

/**
 * "What you have agreed" (§3.1): every consent the platform holds about him
 * that the list read, each with its version, the time it was recorded and
 * who gave it, in the server's own words. Not counted, never a row. A read
 * not made yet says "Reading…"; one that failed says so.
 *
 * @param {{child: any, publicName?: any, consents?: any[] | null | undefined | "off", now: number}} o
 * @returns {{lines: {key: string, label: string, words: string, detail: string | null}[], info: string[]}}
 */
export function recordOf(o) {
  const { child, now } = o;
  const first = firstNameOf(child);
  const lines = [];
  const info = [];
  // The terms, on her own link.
  if (child.consent) {
    const at = stamp(child.consentAt);
    lines.push(child.consent === "granted"
      ? { key: "terms", label: "The school's terms", words: "agreed", detail: [at, child.consentVersion].filter(Boolean).join(" · ") || null }
      : child.consent === "withdrawn"
        ? { key: "terms", label: "The school's terms", words: "withdrawn", detail: at }
        : { key: "terms", label: "The school's terms", words: "not agreed yet", detail: null });
  }
  // His name on public pages.
  const pn = sourceOf(o, "publicName");
  if (!pn.off) {
    const mine = pn.value?.mine;
    if (pn.value === undefined) lines.push({ key: "public_name", label: "Name on public pages", words: "Reading…", detail: null });
    else if (pn.value === null) lines.push({ key: "public_name", label: "Name on public pages", words: couldNotRead("the answer"), detail: null });
    else if (mine) {
      const words = mine.state === "given" ? "on" : mine.state === "not_answered" ? "not answered" : "off";
      const what = mine.state === "given" ? "given by" : mine.state === "withdrawn" ? "turned off by" : mine.state === "refused" ? "a no recorded by" : null;
      lines.push({ key: "public_name", label: "Name on public pages", words,
        detail: what ? [`${what} ${giverWords(mine)}`, stamp(mine.recordedAt) ?? (mine.givenOn ? longDate(mine.givenOn) : null), mine.version].filter(Boolean).join(" · ") : null });
    }
  }
  // Health monitoring, where the consents read answered for him.
  const cs = sourceOf(o, "consents");
  if (!cs.off) {
    if (cs.value === undefined) lines.push({ key: "health", label: "Health monitoring", words: "Reading…", detail: null });
    else if (cs.value === null) lines.push({ key: "health", label: "Health monitoring", words: couldNotRead("the consents"), detail: null });
    else {
      const c = cs.value.find((x) => his(x, child) && x.relation !== "self");
      if (c && c.moduleOn === false) lines.push({ key: "health", label: "Health monitoring", words: `not in use at ${child.schoolName || "the school"}`, detail: null });
      else if (c) {
        const words = c.state === "given" ? "on" : c.state === "not_answered" ? "not answered" : "off";
        const giver = c.givenBy === "self" ? first : giverWords(c);
        lines.push({ key: "health", label: "Health monitoring", words,
          detail: c.state === "not_answered" ? null : [`${c.state === "given" ? "given" : "answered"} by ${giver}`, c.givenOn ? longDate(c.givenOn) : null, c.version].filter(Boolean).join(" · ") });
        if (c.adult === true) info.push(`${first} is eighteen: these consents are ${first}'s to give. You may still say no.`);
      }
    }
  }
  // The link's own end, within thirty days (§3.6): never from a birthday.
  const until = msOf(child.until ? `${child.until}T00:00:00Z` : null);
  if (until != null && until - now <= ENDING_DAYS * DAY && until > now) {
    info.push(`Your link to ${first} ends on ${longDate(child.until)}. After that the record is ${first}'s own.`);
  }
  return { lines, info };
}
