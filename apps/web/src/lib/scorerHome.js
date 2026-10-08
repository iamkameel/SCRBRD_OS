/**
 * The scorer's home (GA-I13): what is on this device to resume, the fixtures
 * he may score with his appointments first, and what is missing before the
 * toss of the next one.
 *
 * KAMEEL'S DECISION (8 Oct 2026). Claiming is unchanged: a scorer whose
 * assignment covers the side may claim any fixture of it (db/33
 * scoring_claim, app_can('scoring.start', …)). The appointment, a fixture-
 * scoped role_assignment or a `scorer` duty on match_official naming him
 * (db/34), only SHAPES THIS LIST: the fixtures he is appointed to first, then
 * the side's other fixtures he may score. Nothing here gates anything.
 *
 * WHAT IS READ, AND NOTHING ELSE. Every input is a read the app already makes
 * (the fixture list, the officials, the session's assignments, the per-fixture
 * duty roster, the events read's fold) or what this device already holds (the
 * pad's saved log and its outbox). No child is named here: a fixture is its
 * two sides, a team sheet is a count, an appointment is the scorer's own.
 *
 * PRESENTATION, NOT AUTHORITY. `mayScore` decides which fixtures to LIST, as
 * session.js couldScore() decides which button to offer; the claim is decided
 * again in Postgres against the same rows.
 *
 * PURE. No React, no DOM, no storage, no clock of its own: `now` is passed in.
 * apps/web/test/scorer-home.test.mjs holds it.
 */
import { roleGrants } from "@scrbrd/policy/roles";
import { couldNotRead } from "./readState.js";

const HOUR = 3600e3;

/** The capability a claim asks for (db/33). */
export const SCORE_CAPABILITY = "scoring.start";

/** How many fixtures the list fans the per-fixture roster read out to; the rest are counted, not drawn. */
export const SHOWN = 8;

/**
 * How old the scoring sessions' read may be before it is said to be out of
 * date. The lease is 90 s (services/api/handover/scoring-session.mjs), so a
 * "held by another device" read two minutes ago may no longer be true.
 */
export const SESSION_MAX_AGE_MS = 2 * 60e3;

/**
 * Does this account land on the scorer's home rather than the day sheet?
 *
 * By capability, never by role name (ADR 0003): it may start scoring, and it
 * neither picks a side (team.select) nor reads a side's roster
 * (player.roster.read). That is the scorer's bundle and no other today: the
 * coach, assistant coach, sports admin and director of sport, who also score,
 * keep the day sheet and its match-day card. A person holding a scorer role
 * beside a coaching one keeps the day sheet too: the roles held are asked.
 * @param {(capability: string) => boolean} holds  holdsAsHeld bound to the badge role
 */
export function scorerLanding(holds) {
  return holds(SCORE_CAPABILITY) && !holds("team.select") && !holds("player.roster.read");
}

/** The fixture's start in ms, or null. @param {any} m */
export function startOf(m) {
  const t = Date.parse(m?.startsAt ?? (m?.date ? `${m.date}T${m.time ?? "00:00"}:00Z` : ""));
  return Number.isFinite(t) ? t : null;
}

/** The SA calendar day (UTC+2, no summer time) of an instant, "YYYY-MM-DD". @param {number} ms */
export const saDay = (ms) => new Date(ms + 2 * HOUR).toISOString().slice(0, 10);

/**
 * May this account score this fixture? One assignment that grants
 * scoring.start and covers the HOME side, the side scoring_claim() asks about
 * (match_school, match_team): its school, its team or none, and its fixture
 * or none. An assignment about a person is never a side.
 * @param {{role: string, school?: string|null, team?: string|null, fixture?: string|null, subjects?: string[]}[]} assignments
 * @param {any} m  a fixture as lib/live.js asMatch() shapes it
 */
export function mayScore(assignments, m) {
  if (!m?.id) return false;
  return (assignments ?? []).some((a) =>
    !!a?.role && roleGrants(a.role, SCORE_CAPABILITY) && !!a.school
    && (a.subjects?.length ?? 0) === 0
    && a.school === m.schoolId
    && (a.team == null || a.team === m.homeTeam)
    && (a.fixture == null || a.fixture === m.id));
}

/**
 * His appointment to score this fixture, or null.
 *
 * Two records say it (db/34): a `scorer` duty on match_official naming him
 * (the office's roster), and a role_assignment narrowed to this fixture that
 * may score (what duty_link() makes of the duty, or one granted directly).
 * Either is an appointment. A duty the office has paused says so, and never
 * why: the reason is the office's record (duty_suspensions), not his.
 * @param {any} m
 * @param {{assignments?: any[]|null, officials?: any[]|null, userId?: string|null}} who
 * @returns {{byDuty: boolean, byAssignment: boolean, appointedAt: string|null, panel: string|null, paused: boolean} | null}
 */
export function appointmentOf(m, { assignments = [], officials = [], userId = null } = {}) {
  if (!m?.id) return null;
  const duty = userId
    ? (officials ?? []).find((o) => o?.matchId === m.id && o.duty === "scorer" && o.personId === userId) ?? null
    : null;
  const byAssignment = (assignments ?? []).some((a) => a?.fixture === m.id && !!a.role && roleGrants(a.role, SCORE_CAPABILITY));
  if (!duty && !byAssignment) return null;
  return {
    byDuty: !!duty, byAssignment,
    appointedAt: duty?.appointedAt ? String(duty.appointedAt).slice(0, 10) : null,
    panel: duty?.panel ?? null,
    paused: duty?.suspended === true,
  };
}

/**
 * Is the fixture one for "Today and next"? Live, whenever it started; still to
 * be played from today on (the SA day); finished today. A fixture still
 * "scheduled" from an earlier day was not played and is not today's.
 * @param {any} m @param {number} now
 */
export function isTodayOrNext(m, now) {
  if (!m?.id) return false;
  if (m.status === "live") return true;
  const t = startOf(m);
  const today = saDay(now);
  if (m.status === "complete") return t != null && saDay(t) === today;
  return t == null || saDay(t) >= today;
}

// ── The state a scorer needs, per fixture ─────────────────────────────

/**
 * What a fixture's scoring session is, for this device and this person.
 *
 * `session` is the `scoring` row of the match_duties read: `state` is the
 * session's (idle, active, handover_pending, verifying) and `held` is whose
 * the token is, worked out by the server against the caller's own token
 * (this_device, you, another, lapsed; services/api/read/read-api.mjs). The
 * client never compares names or device ids itself.
 *
 *   complete         the match is over; completion ends scoring (db/33)
 *   handover         a handover is under way; the pad's take-over is the route
 *   held_here        this device holds the token: open the pad and go on
 *   held_you         your other device holds it: hand over from that one
 *   held_other       another device holds it: the existing claim-handover route
 *   lapsed           live, and no device's lease is current: the pad claims it
 *   live             live, with no session read to say more
 *   not_started      not started
 *
 * @param {any} m  the fixture
 * @param {{state?: string|null, held?: string|null} | null | undefined} session
 */
export function fixtureState(m, session) {
  if (m?.status === "complete") return "complete";
  const st = session?.state ?? null;
  if (st === "handover_pending" || st === "verifying") return "handover";
  if (st && st !== "idle") {
    const held = session?.held ?? null;
    if (held === "this_device") return "held_here";
    if (held === "you") return "held_you";
    if (held === "another") return "held_other";
    if (held === "lapsed") return "lapsed";
    return "live";
  }
  return m?.status === "live" ? "live" : "not_started";
}

/**
 * The words for each state: a label, the one action, and what a scorer needs
 * to know to act. The action opens the pad in every live case, because the pad
 * is where a claim, a refusal and a take-over are already handled (its sync
 * banner and handover sheet); this screen never claims anything itself.
 */
export const STATE_WORDS = Object.freeze({
  not_started: { label: "Not started",                       action: "Start scoring", note: null },
  held_here:   { label: "Live · scoring on this device",     action: "Open the pad",  note: null },
  held_you:    { label: "Live · scoring on your other device", action: "Open the pad",
                 note: "Your other device holds the scoring. Hand over from it, then enter its code on the pad here." },
  held_other:  { label: "Live · another device is scoring",  action: "Open the pad",
                 note: "Only the device that holds the scoring sends. To take over, the scorer on that device hands over and gives you a code to enter on the pad." },
  handover:    { label: "Live · a handover is under way",    action: "Open the pad",
                 note: "Enter the handover code on the pad to take over." },
  lapsed:      { label: "Live · no device is scoring now",   action: "Open the pad",
                 note: "The last device stopped sending. Opening the pad here takes the scoring." },
  live:        { label: "Live",                              action: "Open the pad",  note: null },
  complete:    { label: "Complete",                          action: null,
                 note: "Completion ends scoring. A correction is an amendment." },
});

/**
 * The fixtures he may score, appointed first, then by start.
 *
 * `assignments` null is the demonstration: no session, so the client-scoped
 * fixtures are listed as they are (they were scoped to the demo scorer's side
 * already) and nobody is appointed.
 *
 * @param {object} a
 * @param {any[]} a.matches       the fixture read (asMatch rows)
 * @param {any[]|null} a.assignments  the session's assignments, or null in the demo
 * @param {any[]|null} [a.officials]  the officials read's rows
 * @param {string|null} [a.userId]
 * @param {Map<string, {rows?: any[], error?: any}>|null} [a.coverage]  match_duties per fixture
 * @param {number} a.now
 * @returns {{ items: {match: any, appointment: ReturnType<typeof appointmentOf>, group: "appointed"|"team", state: string, sessionError: boolean}[], shown: any[], later: number }}
 */
export function scorerFixtures({ matches, assignments, officials = [], userId = null, coverage = null, now }) {
  const demo = assignments == null;
  const items = (matches ?? [])
    .filter((m) => isTodayOrNext(m, now))
    .filter((m) => demo || mayScore(assignments, m))
    .map((m) => {
      const appointment = demo ? null : appointmentOf(m, { assignments, officials, userId });
      const cov = coverage?.get?.(m.id) ?? null;
      const session = (cov?.rows ?? []).find((r) => r?.duty === "scoring") ?? null;
      return { match: m, appointment, group: /** @type {"appointed"|"team"} */ (appointment ? "appointed" : "team"),
               state: fixtureState(m, session), sessionError: !!cov?.error };
    });
  const big = Number.MAX_SAFE_INTEGER;
  items.sort((x, y) => (x.group === y.group ? 0 : x.group === "appointed" ? -1 : 1)
    || (startOf(x.match) ?? big) - (startOf(y.match) ?? big)
    || String(x.match.id).localeCompare(String(y.match.id)));
  return { items, shown: items.slice(0, SHOWN), later: Math.max(0, items.length - SHOWN) };
}

/** The fixture the preparation is for: the first in the list not yet started. @param {{state: string, match: any}[]} items */
export const nextToPrepare = (items) => items.find((i) => i.state === "not_started") ?? null;

// ── Resume: what this device is mid-way through ──────────────────────

/**
 * The matches this device is mid-way through, from what it holds: the pad's
 * saved log (persist.js, `match:<id>`) and its outbox (packages/sync,
 * `<match>:<device>:evt:`), the most recently saved first.
 *
 * A saved log is a match to resume when it has events and either something is
 * still to send, or it is not finished: not cleared by the pad at its end
 * (SCRBRD-079 keeps `serverHas` then) and not complete on the server. Only a
 * live fixture's log (its cfg says `live`); a practice match is in its own
 * namespace and the demonstration's logs are not a school's.
 *
 * OPENABLE as App.jsx's restore opens a pad: from the server's fixture row when
 * the server answered; from the sides saved with the log when it did not (no
 * signal, no session: SCRBRD-078). When the server answered WITHOUT the
 * fixture, this person may no longer see it, and a saved log must not become a
 * way back into it: the card says what is on the device and offers no door.
 *
 * @param {object} a
 * @param {{matchId: string, cfg?: any, events?: any[][], serverHas?: number[], savedAt?: number}[]} a.saved
 * @param {Map<string, number|null>} a.pending  unsent events per match on this device; null when the outbox could not be read
 * @param {any[]|null} a.serverMatches  the fixture read's rows, or null when it did not answer
 */
export function resumeItems({ saved, pending, serverMatches }) {
  const out = [];
  for (const s of saved ?? []) {
    const cfg = s?.cfg ?? {};
    if (!s?.matchId || cfg.live !== true) continue;
    const scored = (s.events ?? []).some((e) => Array.isArray(e) && e.length);
    if (!scored) continue;
    const n = pending?.has?.(s.matchId) ? pending.get(s.matchId) : 0;
    const server = serverMatches ? serverMatches.find((m) => m.id === s.matchId) ?? null : null;
    const finished = Array.isArray(s.serverHas) || server?.status === "complete";
    if (!(n == null || n > 0) && finished) continue;
    const openable = !serverMatches || !!server;
    const m = server ?? { id: s.matchId, homeTeam: cfg.team1, awayTeam: cfg.team2, overs: cfg.overs, live: true,
                          startsAt: cfg.startsAt ?? null, format: cfg.format ?? null };
    out.push({ matchId: s.matchId, title: `${m.homeTeam ?? cfg.team1 ?? "Home"} v ${m.awayTeam ?? cfg.team2 ?? "Away"}`,
               pending: n, savedAt: s.savedAt ?? null, finished, openable, match: openable ? { ...m, live: true } : null });
  }
  return out.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

/** "3 to send", "Everything sent", or a count this device could not read. @param {number|null} n */
export function pendingWords(n) {
  if (n == null) return "Could not count what is still to send";
  if (n === 0) return "Nothing waiting to send";
  return `${n} to send`;
}

// ── Preparation for the next fixture ─────────────────────────────────

/**
 * Who fixes each thing, as a role word (GA-I09 D10: the capability is the
 * owner; a name is phase C).
 */
export const OWNER = Object.freeze({
  squad: "the coach",            // team.select
  umpires: "the school office",  // officiating.assign
  ground: "the school office",   // fixture.update
  pitch: "the groundsman",       // facility.manage
  conditions: "the league organiser", // competition.manage
});

/**
 * What is missing before the toss, one line each, from reads that exist: the
 * fixture row (its ground, its competition), the duty roster (team sheet,
 * umpires, pitch report) and the events read's fold (the playing conditions
 * the first ball will fix, SCRBRD-114). A read that did not answer says so in
 * its line; it never reads as "missing".
 *
 * @param {object} a
 * @param {any} a.match
 * @param {any[]|null} a.duties   the match_duties rows, or null when that read did not answer
 * @param {any} [a.fold]          the events read's fold, or undefined while it is coming / null when it did not answer
 * @returns {{key: string, label: string, state: "ok"|"missing"|"unknown"|"loading", text: string, who: string|null}[]}
 */
export function prepLines({ match, duties, fold }) {
  const rows = Array.isArray(duties) ? duties : null;
  const has = (d) => (rows ?? []).filter((r) => r?.duty === d);
  const unread = (what) => ({ state: /** @type {const} */ ("unknown"), text: `${couldNotRead(what)}.`, who: null });
  const lines = [];

  {
    const sq = has("squad")[0];
    lines.push({ key: "squad", label: "Team sheet",
      ...(rows == null ? unread("the duty roster")
        : sq ? { state: "ok", text: sq.detail ? `${sq.detail}` : "Picked", who: null }
        : { state: "missing", text: "Not picked yet", who: OWNER.squad }) });
  }
  {
    const u = has("umpire").length;
    lines.push({ key: "umpires", label: "Umpires",
      ...(rows == null ? unread("the duty roster")
        : u ? { state: "ok", text: `${u} named`, who: null }
        : { state: "missing", text: "None named", who: OWNER.umpires }) });
  }
  lines.push({ key: "ground", label: "Ground",
    ...(match?.venue ? { state: "ok", text: String(match.venue), who: null }
      : { state: "missing", text: "No ground on the fixture", who: OWNER.ground }) });
  {
    const g = has("ground")[0];
    lines.push({ key: "pitch", label: "Pitch report",
      ...(rows == null ? unread("the duty roster")
        : g ? { state: "ok", text: g.detail ? `On record · ${g.detail}` : "On record", who: null }
        : { state: "missing", text: "None on record", who: OWNER.pitch }) });
  }
  {
    const friendly = match?.competitionId == null;
    const line = friendly
      ? { state: "ok", text: "A friendly: the Laws and the fixture's own format", who: null }
      : fold === undefined ? { state: "loading", text: "Reading the playing conditions…", who: null }
      : fold === null ? unread("the playing conditions")
      : fold.conditions
        ? { state: "ok", text: [fold.conditionsTitle ?? "The competition's conditions", fold.conditionsVersion ? `version ${fold.conditionsVersion}` : null].filter(Boolean).join(", "), who: null }
        : { state: "missing", text: "None published for this competition", who: OWNER.conditions };
    lines.push({ key: "conditions", label: "Playing conditions", .../** @type {any} */ (line) });
  }
  return lines;
}
