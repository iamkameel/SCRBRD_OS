/**
 * The scorer's home as a day sheet (R0: ROLE_DASHBOARDS_v1.1 §3D, §4, §5, §7,
 * §9; the widgets of docs/design/ROLE_DASHBOARDS_R0_REGISTRY.md). In the
 * order the day happens, each section shown only when it applies:
 *
 *   p0      only when one applies: something on this phone not yet sent
 *           (scorer.offline_sync), another device holding the scoring of a
 *           match this phone is part-way through (scorer.handover_lease),
 *           events SCRBRD did not take, waiting on the scorer to correct or
 *           discard (scorer.ball_correction, the held list)
 *   now     what this phone is scoring, each on the one Board, with
 *           "Resume scoring" (scorer.resume_session); its own empty state
 *   start   the quick-start: the pad's own Pilot Match setup
 *           (scorer.start_pilot_match). No second flow
 *   pilots  finished Pilot Matches, each "kept as a sandbox". Promotion is
 *           R1 (PILOT_MATCH_PHASE2 §6), so there is no promote action
 *   week    the fixtures he may score in the next seven days, as a list, and
 *           what is missing before the toss of the next one; only when he has
 *           any, or when the read did not answer (a failure is never "none")
 *
 * EVERY INPUT IS WHAT THE PHONE OR AN EXISTING READ ALREADY HOLDS: the pad's
 * saved logs and its outbox (lib/deviceMatches.js), the Pilot and Practice
 * stores (lib/pilot.js, lib/practice.js), the server's own Pilot Matches
 * (GET /api/pilot/mine) and the fixture list (lib/scorerHome.js). Nothing is
 * counted here that the phone did not count: an outbox that could not be read
 * is null, never 0. A Pilot Match is in no figure: the only numbers drawn are
 * a match's own score, from its own log.
 *
 * NO CHILD IS NAMED HERE. A match is its two sides; the board is drawn with
 * the total, the overs, the rates and the over, without the batters or the
 * bowler (the pad shows them, to the scorer at the crease).
 *
 * PURE. No React, no DOM, no storage, no clock of its own: `now` is passed in.
 * apps/web/test/scorer-day.test.mjs holds it.
 */
import { boardOfLog } from "./boardOfLog.js";
export { boardOfLog };
import { saDay, startOf } from "./scorerHome.js";
import { pilotStateWords } from "./pilot.js";

/** The sections, in the order the home draws them. */
export const SECTION_ORDER = Object.freeze(["p0", "now", "start", "pilots", "week"]);

const DAY = 864e5;
/** The week is seven SA days from today (§4: "7 days by default"). */
export const WEEK_DAYS = 7;

/** A read state that is not an answer: the section stays, and says so. */
const UNANSWERED = new Set(["loading", "failed", "forbidden", "disabled", "partial", "stale"]);

// ── Now: what this phone is scoring ──────────────────────────────────

/**
 * Everything this phone is part-way through, newest save first: a fixture's
 * log (lib/scorerHome.js resumeItems, which already decided what is
 * resumable and whether it may open), and a Pilot or Practice Match not yet
 * finished (their stores' own rows, summarise()'s `complete`).
 *
 * @param {object} a
 * @param {any[]} a.fixtures   resumeItems() rows, each with `events`, `curIn` and `overs` from its saved log
 * @param {any[]} a.pilots     listPilot() rows, each with `log` (its saved log)
 * @param {any[]} a.practices  listPractice() rows, each with `log`
 * @param {Map<string, number | null> | null} a.pending  unsent events per match on this phone; null when the outbox could not be read
 * @param {Map<string, number | null> | null} a.held     held events per match on this phone; null when the outbox could not be read
 */
export function nowItems({ fixtures = [], pilots = [], practices = [], pending = null, held = null }) {
  /** @param {Map<string, number|null> | null} m @param {string} id */
  const count = (m, id) => (m == null ? null : m.has(id) ? m.get(id) ?? null : 0);
  const out = [];
  for (const r of fixtures ?? []) {
    if (!r?.matchId) continue;
    out.push({ key: r.matchId, kind: /** @type {const} */ ("fixture"), matchId: r.matchId, title: r.title,
      pending: r.pending === undefined ? count(pending, r.matchId) : r.pending, held: count(held, r.matchId),
      savedAt: r.savedAt ?? null, openable: r.openable !== false, match: r.match ?? null,
      board: boardOfLog(r.events, { curIn: r.curIn, overs: r.overs ?? r.match?.overs ?? null }) });
  }
  for (const [kind, rows] of /** @type {const} */ ([["pilot", pilots], ["practice", practices]])) {
    for (const r of rows ?? []) {
      if (!r?.id) continue;
      const sent = kind === "practice";
      const p = sent ? 0 : count(pending, r.id), h = sent ? 0 : count(held, r.id);
      // Review S1: a finished Pilot Match stays while anything of it has not
      // reached SCRBRD (balls, held events, an outbox nobody could read, or its
      // call-off), as resumeItems() keeps a fixture's log.
      const callingOff = kind === "pilot" && !!r.meta?.pilot?.callOff && r.meta?.pilot?.abandoned !== true && r.meta?.pilot?.finished !== true;
      const unsent = kind === "pilot" && (p == null || h == null || p > 0 || h > 0 || callingOff);
      if (r.complete && !unsent) continue;
      // Review S5: a match whose log this phone could not read is said, never dropped.
      if (r.logError) {
        out.push({ key: r.id, kind, matchId: r.id, title: r.title, pending: p, held: h, savedAt: r.savedAt ?? null, openable: true, match: null,
                   board: null, error: true, finished: !!r.complete, callingOff });
        continue;
      }
      // A store row (lib/pilot.js pilotHomeRows) brings its board and whether it has events, never its log (review S6).
      const scored = typeof r.hasEvents === "boolean" ? r.hasEvents : (r.log?.events ?? []).some((/** @type {any} */ e) => Array.isArray(e) && e.length);
      if (!scored) continue;
      out.push({ key: r.id, kind, matchId: r.id, title: r.title,
        // A practice match is never sent anywhere, so it has no outbox at all.
        pending: p, held: h,
        savedAt: r.savedAt ?? null, openable: true, match: null, finished: !!r.complete, callingOff,
        board: "board" in r ? r.board : boardOfLog(r.log?.events, { curIn: r.log?.curIn ?? null, overs: r.meta?.match?.overs ?? r.log?.cfg?.overs ?? null }) });
    }
  }
  return out.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

// ── P0: only what applies, and what to do about it ───────────────────

/** The fixture states that mean another device holds, or is handing over, the scoring (lib/scorerHome.js fixtureState). */
const HELD_ELSEWHERE = new Set(["held_other", "held_you", "handover"]);

/** The words of each P0 item. */
export const P0_WORDS = Object.freeze({
  queue: (/** @type {number} */ n) => `${n} to send · saved on this phone, not yet on SCRBRD`,
  queueNote: "It goes when there is signal and a sign-in. Open the pad to send it.",
  held: (/** @type {number} */ n) => `${n} held for you to check`,
  heldNote: "SCRBRD did not take these. Open the pad to correct or discard each one.",
  lease: {
    held_other: "Another device is scoring this match",
    held_you: "Your other device is scoring this match",
    handover: "A handover is under way",
    pilot_active: "Another phone is scoring this match",
    pilot_lapsed: "Another phone held the scoring and has stopped sending",
  },
  leaseNote: {
    held_other: "Only the device that holds the scoring sends. To take over, the scorer on that device hands over and gives you a code to enter on the pad.",
    held_you: "Hand over from that device, then enter its code on the pad here.",
    handover: "Enter the handover code on the pad to take over.",
    pilot_active: "Only the phone that holds the scoring sends. What this phone scores waits until it holds it again.",
    pilot_lapsed: "Open the pad here to take over, then carry on.",
  },
  // Review S1: a call-off made on this phone, not yet on SCRBRD.
  calloff: "Calling off · not yet on SCRBRD",
  calloffNote: "Open the pad: it calls the match off on SCRBRD once the end of the innings has gone.",
  // Review S5: a match whose balls this phone could not read.
  unread: "Could not read this match's balls on this phone",
  unreadNote: "Open the pad to try again. Nothing is deleted.",
  // Review S3: a change to the match's record that did not save.
  write: "A change to this match did not save on this phone",
  writeNote: (/** @type {string} */ what) => `What did not save: ${what}. Open the pad to try again.`,
});

/**
 * What needs the scorer first, in the order the brief gives: what is not yet
 * sent, a device that holds the scoring of a match on this phone, and events
 * held for him to check. Each names its match and opens the pad, where the
 * send, the take-over and the held list already live; nothing here sends,
 * claims or clears anything.
 *
 * @param {ReturnType<typeof nowItems>} now
 * @param {object} [o]
 * @param {Map<string, string> | null} [o.fixtureStates]  match id → fixtureState() from the duty roster read
 * @param {Map<string, {holderDevice?: string|null, leaseUntil?: string|null} | null> | null} [o.pilotSessions]
 *        pilot id → the server's session for it (GET /api/pilot/mine); null when that read did not answer
 * @param {string | null} [o.device]  this phone's device id
 * @param {number} [o.at]              the clock
 * @param {{id: string, what: string, title?: string | null}[]} [o.failures]  record writes that did not save (lib/pilot.js writeFailures)
 * @returns {{kind: "queue"|"lease"|"held"|"calloff"|"unread"|"write", key: string, matchId: string, title: string, label: string, note: string, item: any}[]}
 */
export function p0Items(now, { fixtureStates = null, pilotSessions = null, device = null, at = 0, failures = [] } = {}) {
  /** @type {any[]} */
  const queue = [], lease = [], held = [], calloff = [], unread = [], write = [];
  for (const it of now ?? []) {
    if (it.openable === false) continue;
    if (typeof it.pending === "number" && it.pending > 0) {
      queue.push({ kind: "queue", key: `queue-${it.key}`, matchId: it.matchId, title: it.title, label: P0_WORDS.queue(it.pending), note: P0_WORDS.queueNote, item: it });
    }
    let why = null;
    if (it.kind === "fixture") {
      const st = fixtureStates?.get?.(it.matchId) ?? null;
      if (st && HELD_ELSEWHERE.has(st)) why = st;
    } else if (it.kind === "pilot" && device && !it.finished) {
      const s = pilotSessions?.get?.(it.matchId) ?? null;
      if (s?.holderDevice && s.holderDevice !== device) {
        const until = Date.parse(s.leaseUntil ?? "");
        why = Number.isFinite(until) && until > at ? "pilot_active" : "pilot_lapsed";
      }
    }
    if (why) {
      lease.push({ kind: "lease", key: `lease-${it.key}`, matchId: it.matchId, title: it.title,
        label: /** @type {any} */ (P0_WORDS.lease)[why], note: /** @type {any} */ (P0_WORDS.leaseNote)[why], why, item: it });
    }
    if (typeof it.held === "number" && it.held > 0) {
      held.push({ kind: "held", key: `held-${it.key}`, matchId: it.matchId, title: it.title, label: P0_WORDS.held(it.held), note: P0_WORDS.heldNote, item: it });
    }
    if (it.callingOff) calloff.push({ kind: "calloff", key: `calloff-${it.key}`, matchId: it.matchId, title: it.title, label: P0_WORDS.calloff, note: P0_WORDS.calloffNote, item: it });
    if (it.error) unread.push({ kind: "unread", key: `unread-${it.key}`, matchId: it.matchId, title: it.title, label: P0_WORDS.unread, note: P0_WORDS.unreadNote, item: it });
  }
  for (const f of failures ?? []) {
    if (!f?.id) continue;
    const item = (now ?? []).find((i) => i.matchId === f.id) ?? { key: f.id, kind: "pilot", matchId: f.id, title: f.title ?? "A Pilot Match", openable: true };
    write.push({ kind: "write", key: `write-${f.id}`, matchId: f.id, title: item.title, label: P0_WORDS.write, note: P0_WORDS.writeNote(f.what || "a change"), item });
  }
  return [...queue, ...lease, ...held, ...calloff, ...unread, ...write];
}

// ── Finished Pilot Matches: kept as a sandbox ────────────────────────

/** The sandbox's words (PILOT_MATCH_PHASE2 §1: "Keep as sandbox" is the default, not an act). */
export const SANDBOX_WORDS = Object.freeze({
  kept: "Kept as a sandbox",
  why: "Counted in no figure, standing or record.",
  empty: "No finished Pilot Match yet. One that is finished is kept here as a sandbox, counted in no figure, standing or record.",
});

/**
 * The finished Pilot Matches, newest first: those on this phone (their own
 * store says finished) and, when the server answered, those it holds that
 * this phone does not (finished or abandoned; never a promoted one, which
 * pilot_mine() does not return). One row per match.
 * @param {any[]} phone   listPilot() rows
 * @param {any[] | null} server  GET /api/pilot/mine's matches, or null when it did not answer
 * @param {(id: string) => string | null} uuidOf  lib/pilot.js pilotUuid
 */
export function finishedPilots(phone, server, uuidOf) {
  const here = new Set();
  const out = [];
  const served = new Map((server ?? []).filter((m) => m?.id).map((m) => [m.id, m.status]));
  for (const r of phone ?? []) {
    if (!r?.id) continue;
    here.add(uuidOf(r.id));
    if (!r.complete) continue;
    // Review N1: the server's status first, then this phone's, as My Pilot Matches says it (lib/pilot.js pilotStateWords).
    const words = pilotStateWords({ meta: r.meta, complete: true, serverStatus: served.get(uuidOf(r.id) ?? "") ?? null });
    out.push({ key: r.id, id: r.id, title: r.title, onPhone: true, words,
               status: words === "Called off" ? "abandoned" : words === "Calling off…" ? "calling_off" : "finished",
               lines: r.lines ?? [], at: r.savedAt ?? null });
  }
  for (const m of server ?? []) {
    if (!m?.id || here.has(m.id)) continue;
    if (m.status !== "finished" && m.status !== "abandoned") continue;
    const sides = Array.isArray(m.sides) && m.sides.length === 2 ? `${m.sides[0].display_name} v ${m.sides[1].display_name}` : "Pilot match";
    out.push({ key: `server-${m.id}`, id: m.id, title: sides, onPhone: false, status: m.status, words: pilotStateWords({ serverStatus: m.status }), lines: [],
               at: Date.parse(m.endedAt ?? m.lastEventAt ?? m.startsAt ?? "") || null });
  }
  return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

/** "Hilton U13B 84/3 (12.0 ov)": an innings' own score. @param {{team: string, runs: number, wickets: number, balls: number}} l */
export const scoreLine = (l) => `${l.team} ${l.runs}/${l.wickets} (${Math.floor(l.balls / 6)}.${l.balls % 6} ov)`;

// ── This week: the fixtures he may score ─────────────────────────────

/**
 * The fixtures of the next seven SA days, from the list lib/scorerHome.js
 * already ordered (appointed first, then by start): a live one whenever it
 * started, one with no start (it says so), and every other within the week.
 * `later` counts the rest of his list, which the Match Centre lists.
 * @param {{items: any[], shown: any[]}} list  scorerFixtures()'s answer
 * @param {number} now
 */
export function weekOf(list, now) {
  const end = saDay(now + WEEK_DAYS * DAY);
  const inWeek = (/** @type {any} */ i) => {
    if (i?.match?.status === "live") return true;
    const t = startOf(i?.match);
    return t == null || saDay(t) < end;
  };
  const week = (list?.shown ?? []).filter(inWeek);
  return { week, later: Math.max(0, (list?.items?.length ?? 0) - week.length) };
}

// ── Which sections show ──────────────────────────────────────────────

/**
 * The sections the home draws, in SECTION_ORDER.
 *
 *   p0      when at least one item applies
 *   now     always: an empty phone says so (its empty state)
 *   start   always: the landing already asked for scoring.start
 *   pilots  when this account may send Pilot Matches, or any is on this
 *           phone or on the server: a scorer with no pilot is not shown one
 *   week    when he has a fixture this week, or the fixtures read did not
 *           answer (loading, failed, refused, partial, stale)
 *
 * @param {object} s
 * @param {number} s.p0          p0Items().length
 * @param {boolean} s.pilotOffer lib/pilot.js mayOfferLive(status)
 * @param {number} s.pilotsKnown Pilot Matches on this phone or the server, finished or not
 * @param {number} s.week        weekOf().week.length
 * @param {string | null} s.weekRead  the fixtures read's state (lib/readState.js), or null in the demonstration
 * @returns {string[]}
 */
export function homeSections({ p0 = 0, pilotOffer = false, pilotsKnown = 0, week = 0, weekRead = null }) {
  const on = {
    p0: p0 > 0,
    now: true,
    start: true,
    pilots: pilotOffer === true || pilotsKnown > 0,
    week: week > 0 || (weekRead != null && UNANSWERED.has(weekRead)),
  };
  return SECTION_ORDER.filter((k) => /** @type {Record<string, boolean>} */ (on)[k]);
}

/**
 * The start entry's words, from what SCRBRD last said of this account
 * (lib/pilot.js pilotStatus: `{sync, granted, names}`, or null when nothing
 * is known). The setup is the pad's (scorer/practice.jsx PracticeSetup): it
 * offers "Send live to SCRBRD" only when this is `pilot`; otherwise the
 * match stays on this phone as a Practice Match, and this says so first.
 * @param {any} status  @param {boolean} loading  the status read is still coming
 * @returns {{state: "loading"|"pilot"|"off"|"not_granted"|"unknown", action: string, note: string}}
 */
export function startWords(status, loading = false) {
  const what = "Venue, overs, both sides and their players typed in, the toss, then the pad.";
  // Review N5: "Start a match" until the grant is known; the setup may offer practice only.
  if (loading && !status) return { state: "loading", action: "Start a match", note: `${what} Checking whether your account sends Pilot Matches…` };
  if (status?.sync && status?.granted) {
    return { state: "pilot", action: "Start Pilot Match",
             note: `${what} Sent to SCRBRD as you score, so you can carry on on another phone. The live page shows the score and team names only.` };
  }
  if (status?.sync && !status?.granted) {
    return { state: "not_granted", action: "Start Practice Match", note: `${what} Your account can't send Pilot Matches, so this one stays on this phone.` };
  }
  if (status && !status.sync) {
    return { state: "off", action: "Start Practice Match", note: `${what} Pilot Matches are not switched on yet, so this one stays on this phone.` };
  }
  return { state: "unknown", action: "Start Practice Match",
           note: `${what} SCRBRD could not be asked whether your account sends Pilot Matches, so this one stays on this phone.` };
}
