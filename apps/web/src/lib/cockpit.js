/**
 * THE COACH'S MATCH-DAY COCKPIT — the plain parts (SCRBRD-136 phase A,
 * docs/design/SCRBRD-136-137_coach_cockpit_and_feed.md).
 *
 * NOTHING HERE DECIDES WHAT ANYBODY MAY READ. The server's reads do that, under
 * the reader's own policy. This module decides what to DRAW: whether the Coach
 * tab and the Dashboard's match-day card are offered at all (§1.2), which panels
 * of it (each checks its own capability), and how the rows the reads returned
 * are put into words — health as a status tier only (D4), load as a word and
 * one fixed sentence (D7), lifts as a head count (D10).
 *
 * Pure, so the rules are proved under plain node
 * (apps/web/test/cockpit.test.mjs): no DOM, no database, no clock.
 */
import { ROLES, SUBJECT_SCOPED_ROLES, roleGrants } from "@scrbrd/policy/roles";
import { oversOf, sideOfTeam } from "./matchCentre.js";

// ── Who gets it (§1) ───────────────────────────────────

/**
 * What lets a person in at all: either one. The role table in the design (§1.2)
 * is derived from roles.mjs through these and PANEL_CAPABILITY below, never
 * typed (A1) — apps/web/test/cockpit.test.mjs holds the derived table equal to
 * the design's.
 */
export const ENTRY_CAPABILITIES = Object.freeze(["team.select", "player.workload.read"]);

/**
 * Each panel's own capability. A panel is drawn when the single assignment
 * that let the person in grants ALL of the capabilities listed for it (ADR 0001:
 * one assignment, never a union). Names are the design's panel words.
 */
export const PANEL_CAPABILITY = Object.freeze({
  day:        ["fixture.read"],                          // P1: format, pitch, weather, umpires
  team:       ["team.read"],                             // S1, S6: the sheet itself
  side:       ["team.read", "availability.read"],        // P2, S3, S7: who has answered
  status:     ["medical.status.read"],                   // P2: restricted, and until when (the status tier only)
  select:     ["team.select"],                           // S3, S6: the selection signals
  load:       ["player.workload.read"],                  // P3, P6's directive, S2b, S11
  opposition: ["opposition.read"],                       // P4
  bus:        ["transport.read"],                        // P1's bus line, S1
  lifts:      ["transport.lift.receive"],                // P1's head count, S1's subtraction, S4a
  liftOffice: ["transport.lift.oversee"],                // S4b: the office's, never the coach's
  matchups:   ["player.performance.read"],               // S5, P9
});

/** @typedef {{[K in keyof typeof PANEL_CAPABILITY]: boolean}} Panels */

/** The panels one role's bundle grants: pure over roles.mjs. @param {string} role @returns {Panels} */
export function panelsOf(role) {
  return /** @type {Panels} */ (Object.fromEntries(Object.entries(PANEL_CAPABILITY)
    .map(([panel, caps]) => [panel, caps.every((c) => roleGrants(role, c))])));
}

/** Does this role pass the entry rule on capabilities alone (scope aside)? @param {string} role */
export function entersAs(role) {
  return !SUBJECT_SCOPED_ROLES.includes(role) && ENTRY_CAPABILITIES.some((c) => roleGrants(role, c));
}

/**
 * The §1.2 table, derived: one row per role in roles.mjs. `enters` also names
 * why ("select", "load", both).
 * @returns {{role: string, enters: false | "select" | "load" | "both", panels: Panels}[]}
 */
export function entryTable() {
  return ROLES.map((role) => {
    const sel = roleGrants(role, "team.select"), load = roleGrants(role, "player.workload.read");
    return { role, enters: entersAs(role) ? (sel && load ? "both" : sel ? "select" : "load") : false, panels: panelsOf(role) };
  });
}

/**
 * Which end of the fixture an assignment covers, or null. The home side is the
 * fixture's school and team; the away side is `awaySchoolId` and
 * `awayTeamCode`. An assignment with no team covers the school's side.
 * @param {{school: string | null, team: string | null}} a
 * @param {{schoolId: string | null, homeTeam: string | null, awaySchoolId: string | null, awayTeamCode: string | null}} match
 * @returns {"home" | "away" | null}
 */
export function endCovered(a, match) {
  if (a.school && match.schoolId === a.school && (a.team == null || a.team === match.homeTeam)) return "home";
  if (a.school && match.awaySchoolId != null && match.awaySchoolId === a.school && (a.team == null || a.team === match.awayTeamCode)) return "away";
  return null;
}

/**
 * THE GATE (§1.2): is the Coach tab, the match-day card and the feed offered
 * for this fixture, and which panels of it?
 *
 * One assignment, never a union (ADR 0001), that is school- or team-scoped —
 * never platform-wide, never one that names a person (guardian, selfaccess,
 * enquiry) — covers the fixture's side, and grants `team.select` or
 * `player.workload.read`. A role is never named: an assignment is asked what
 * it grants. When several qualify the one granting the most panels is used,
 * the first on a tie. Fails closed: no assignments, no match, no tab.
 *
 * The caller passes the session's assignments (lib/session.js); a signed-out
 * demonstration has none and is never offered the tab. This is layout, not
 * authority: every read behind it is decided again by the database.
 *
 * @param {{role: string, school: string | null, team: string | null, fixture?: string | null, subjects?: string[]}[] | null | undefined} assignments
 * @param {any} match  the Match Centre's fixture row
 * @returns {{end: "home" | "away", role: string, school: string, team: string | null, teamCode: string | null, panels: Panels} | null}
 */
export function cockpitGate(assignments, match) {
  if (!match?.id) return null;
  /** @type {ReturnType<typeof cockpitGate>} */
  let best = null;
  let bestN = -1;
  for (const a of assignments ?? []) {
    if (!a?.role || !a.school || !entersAs(a.role)) continue;
    if ((a.subjects?.length ?? 0) > 0) continue;            // about a person, not a side
    if (a.fixture && a.fixture !== match.id) continue;       // a scorer's single fixture is not a side
    const end = endCovered(a, match);
    if (!end) continue;
    const panels = panelsOf(a.role);
    const n = Object.values(panels).filter(Boolean).length;
    if (n > bestN) {
      bestN = n;
      best = { end, role: a.role, school: a.school, team: a.team ?? null,
               teamCode: (end === "home" ? match.homeTeam : match.awayTeamCode) ?? null, panels };
    }
  }
  return best;
}

// ── The fixture's clock ────────────────────────────────

const HOUR = 3600e3;

/** The fixture's start in ms, or null. @param {any} match */
export function startMs(match) {
  const t = Date.parse(match?.startsAt ?? (match?.date ? `${match.date}T${match.time ?? "00:00"}:00+02:00` : ""));
  return Number.isFinite(t) ? t : null;
}

/** Is the fixture still to be played and within `hours` of starting (SOON = 48)? @param {any} match @param {number} now */
export function isSoon(match, now, hours = 48) {
  const t = startMs(match);
  return match?.status === "upcoming" && t != null && t > now - 6 * HOUR && t - now <= hours * HOUR;
}

/** The SA calendar day (SAST is UTC+2, no summer time) of an instant, as "YYYY-MM-DD". @param {number} ms */
export const saDay = (ms) => new Date(ms + 2 * HOUR).toISOString().slice(0, 10);

/** "14 Oct" for an ISO date or instant, read as the SA calendar day. @param {string | null | undefined} iso */
export function shortDate(iso) {
  const t = Date.parse(String(iso ?? "").length <= 10 ? `${iso}T12:00:00+02:00` : String(iso));
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 2 * HOUR);
  const month = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ")[d.getUTCMonth()];
  return `${d.getUTCDate()} ${month[0].toUpperCase()}${month.slice(1)}`;
}

/** "07:15" for an instant, on the SA clock. @param {string | null | undefined} iso */
export function saTime(iso) {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? new Date(t + 2 * HOUR).toISOString().slice(11, 16) : null;
}

/** Is today the fixture's day (SA)? @param {any} match @param {number} now */
export function isMatchDay(match, now) {
  const t = startMs(match);
  return t != null && saDay(t) === saDay(now);
}

/** Is the fixture the next one within `days` days? @param {any} match @param {number} now */
export function isWithin(match, now, days = 7) {
  const t = startMs(match);
  return match?.status === "upcoming" && t != null && t > now - 6 * HOUR && t - now <= days * 24 * HOUR;
}

// ── Health, as a status tier only (D4) ─────────────────

/**
 * The side (P2): the boys on the sheet for our end, in batting order, each with
 * the family's word and, where the physio has restricted him, until when. The
 * row carries exactly these fields and no others: not the reason an absence was
 * given, not an injury's nature or severity or phase (D4). A reader who holds
 * not `medical.status.read` has restricted boys drawn as the family's word.
 *
 * @param {any[] | null} readiness  the `readiness` read, adapted
 * @param {"home" | "away"} end
 * @param {{status: boolean}} may
 * @returns {{id: string, name: string, battingNo: number | null, state: string, words: string, byWhom: string | null, back: string | null}[]}
 */
export function sideRows(readiness, end, may) {
  return (readiness ?? []).filter((r) => r.selected && (r.side == null || r.side === end))
    .map((r) => {
      const restricted = may.status && r.clinicallyRestricted === true;
      const state = restricted ? "restricted"
        : r.declaredStatus === "unavailable" ? "unavailable"
        : r.declaredStatus == null ? "unanswered"
        : r.declaredStatus === "needs_reconfirming" ? "needs_reconfirming"
        : r.declaredStatus === "doubtful" ? "doubtful" : "available";
      return { id: r.playerId, name: r.name, battingNo: r.battingNo ?? null, state,
        words: STATE_WORDS[state] ?? state,
        byWhom: state === "unavailable" || state === "doubtful"
          ? (r.selfDeclared ? "said himself" : r.declaredByName ? `said by ${r.declaredByName}` : "said by the family") : null,
        back: restricted ? (r.returnDate ?? null) : null };
    })
    .sort((a, b) => (a.battingNo ?? 99) - (b.battingNo ?? 99) || a.name.localeCompare(b.name));
}

/** The words for a state. Words, not colours: no state is told by colour alone. */
export const STATE_WORDS = Object.freeze({
  available: "available", unavailable: "unavailable", doubtful: "doubtful",
  unanswered: "no answer", needs_reconfirming: "asked again", restricted: "restricted",
});

/** "11 named · 1 to chase · 1 restricted" for the sheet's foot. @param {ReturnType<typeof sideRows>} rows */
export function sideFoot(rows) {
  const chase = rows.filter((r) => r.state === "unanswered" || r.state === "needs_reconfirming").length;
  const restricted = rows.filter((r) => r.state === "restricted").length;
  const out = rows.filter((r) => r.state === "unavailable").length;
  return [`${rows.length} named`, chase ? `${chase} to chase` : null, out ? `${out} unavailable` : null, restricted ? `${restricted} restricted` : null]
    .filter(Boolean).join(" · ");
}

// ── Load, as a word and one sentence (D7) ──────────────

/** SCRBRD-110 §2.2's fixed sentence: every screen that shows a word shows this beneath it. */
export const LOAD_SENTENCE = "A guide to a conversation, not a diagnosis.";

/** The seven words (db/60 load_word()). Anything else is not drawn. */
export const LOAD_WORDS = Object.freeze(["no load", "rested", "too little to say", "light", "steady", "rising", "spike"]);

/**
 * Our bowlers this week (P3): pace bowlers only, the most overs first. The
 * word and the directive's figures; never the ratio behind the word, never a
 * guideline's basis (D6), never whether he is monitored (D5).
 * @param {any[] | null} workload  the `workload` read, adapted
 * @param {Set<string> | null} [onSheet]  the player ids on the sheet; null = everyone the read returned
 * @returns {{id: string, name: string, overs: number, word: string | null, estimate: boolean, spell: number | null, day: number | null, band: string | null, clause: string | null}[]}
 */
export function weekRows(workload, onSheet = null) {
  return (workload ?? []).filter((w) => w.pace === true && (!onSheet || onSheet.has(w.playerId)))
    .map((w) => ({ id: w.playerId, name: w.name, overs: w.overs7d ?? 0,
      word: LOAD_WORDS.includes(w.loadWord) ? w.loadWord : null, estimate: w.estimated7d === true,
      spell: w.maxSpell ?? null, day: w.maxDay ?? null, band: w.ageBand ?? null, clause: w.clause?.code ?? null }))
    .sort((a, b) => b.overs - a.overs || a.name.localeCompare(b.name));
}

/** "14 ov · steady (estimate)" @param {ReturnType<typeof weekRows>[number]} r */
export function weekWords(r) {
  return [`${r.overs} ov`, r.word ? `${r.word}${r.estimate ? " (estimate)" : ""}` : null].filter(Boolean).join(" · ");
}

/** "6 a spell, 12 a day · U15" @param {ReturnType<typeof weekRows>[number]} r */
export function limitWords(r) {
  const bits = [r.spell != null ? `${r.spell} a spell` : null, r.day != null ? `${r.day} a day` : null].filter(Boolean).join(", ");
  return bits ? `${bits}${r.band ? ` · ${r.band}` : ""}` : null;
}

// ── The bus, and who is coming by lift (D10) ───────────

/**
 * The bus for our side: the trips on this fixture that are not cancelled and
 * are the school's, their seats summed. Null when none is arranged.
 * @param {any[] | null} trips  the `trips` read, adapted
 * @param {string} school
 * @returns {{capacity: number, seatsTaken: number, departAt: string | null, pickup: string | null, vehicles: number} | null}
 */
export function busOf(trips, school) {
  const mine = (trips ?? []).filter((t) => t.school === school && t.state !== "cancelled");
  if (!mine.length) return null;
  const first = [...mine].sort((a, b) => String(a.departAt ?? "").localeCompare(String(b.departAt ?? "")))[0];
  return { capacity: mine.reduce((n, t) => n + (t.capacity ?? 0), 0), seatsTaken: mine.reduce((n, t) => n + (t.seatsTaken ?? 0), 0),
    departAt: first.departAt ?? null, pickup: first.pickup ?? null, vehicles: mine.length };
}

/**
 * The lifts as a head count and nothing else (D10): the rows
 * `lift_expected()` returned, reduced to numbers. No name, no driver, no
 * phone number survives this function.
 * @param {any[] | null} rows  GET /api/matches/:id/lifts/expected
 * @param {number} now  ms
 * @returns {{boys: Set<string>, count: number, lifts: number, notLeft: number, handedOverUnconfirmed: number} | null}
 */
export function liftCounts(rows, now) {
  if (!Array.isArray(rows)) return null;
  const boys = new Set(rows.map((r) => r.playerId).filter(Boolean));
  const notLeftOffers = new Set(rows.filter((r) => r.notLeft).map((r) => r.offerId));
  const unconfirmed = rows.filter((r) => r.handedOverAt && !r.acknowledgedAt && !r.resolvedAt && Date.parse(r.handedOverAt) + 30 * 60e3 <= now);
  return { boys, count: boys.size, lifts: new Set(rows.map((r) => r.offerId)).size, notLeft: notLeftOffers.size, handedOverUnconfirmed: unconfirmed.length };
}

// ── The day: conditions, the band's line ───────────────

/**
 * The match's terms in the shape the pad's own words take
 * (scorer/conditionsLine.jsx), from `GET /api/matches/:id/playing-conditions`:
 * the document's play part, its sources and the version's title. The same
 * object `termsOf(fold)` gives from the events read, so P6's cap sentences are
 * the pad's and the Captain tab's. Null when the document says nothing.
 * @param {any} r  the route's answer
 */
export function termsFromConditions(r) {
  const play = r?.doc?.play;
  if (!play || typeof play !== "object" || Object.keys(play).length === 0) return null;
  return { conditions: play, sources: r.sources ?? null, title: r.setTitle ?? null, version: r.setVersion ?? null, fixed: r.fixed === true };
}

/**
 * What the route says about the fixture's conditions, for P1's cap line and
 * S10: "set" when a competition's version governs it or the document is fixed,
 * "defaults" when the platform's alone does, "failed" when the route did not
 * answer. `cap` and `freeHit` are only what the document names.
 * @param {any} r  the route's answer, or null when it failed
 * @returns {{state: "set" | "defaults" | "failed", cap: number | null, freeHit: boolean | null}}
 */
export function conditionsState(r) {
  if (!r || typeof r !== "object" || !r.doc) return { state: "failed", cap: null, freeHit: null };
  const play = r.doc.play ?? {};
  const cap = Number.isInteger(play["bowling.max_overs_per_bowler_innings"]) ? play["bowling.max_overs_per_bowler_innings"] : null;
  const freeHit = typeof play["format.free_hit"] === "boolean" ? play["format.free_hit"] : null;
  return { state: r.setId || r.fixed === true ? "set" : "defaults", cap, freeHit };
}

/** The pitch report in one line is lib/captain.js pitchWords(); the weather in one: "22° overcast, rain likely". @param {any} w */
export function weatherWords(w) {
  if (!w) return null;
  const temp = w.tempC != null ? `${w.tempC}°` : null;
  const rain = w.rainChancePct != null && w.rainChancePct >= 40 ? "rain likely" : null;
  return [[temp, String(w.condition ?? "").toLowerCase() || null].filter(Boolean).join(" "), rain].filter(Boolean).join(", ") || null;
}

// ── Our side's innings in the fold ─────────────────────

/**
 * Which of the match's innings our side batted and which it fielded in. By the
 * side the innings names (sideOfTeam), else by our own players' ids; an innings
 * that neither says is neither (the tab then draws nothing "ours" from it).
 * @param {any} match  @param {"home" | "away"} end  @param {any[]} innings  the fold's, in order
 * @param {Set<string>} ours  the ids of our side's players (the sheet)
 * @returns {{inn: any, i: number, side: "batting" | "bowling" | null}[]}
 */
export function ourInnings(match, end, innings, ours) {
  const ids = (/** @type {any[]} */ xs) => (xs ?? []).map((p) => p?.id ?? p);
  const has = (/** @type {any[]} */ xs) => ids(xs).some((id) => ours.has(id));
  return (innings ?? []).map((inn, i) => {
    if (!inn || inn.superOver != null) return { inn, i, side: null };
    const s = sideOfTeam(match, inn.battingTeam);
    const side = s ? (s === end ? "batting" : "bowling") : has(inn.batsmen) ? "batting" : has(inn.bowlers) ? "bowling" : null;
    return { inn, i, side };
  });
}

/**
 * The spells as the log recorded them (P9): "5 overs; the directive allowed
 * 4; a breach is on record". One line per spell, ours only. Drawn under
 * `player.workload.read` by the caller.
 * @param {any[] | null} spells  the `bowling_spells` read, adapted
 * @param {Set<string>} ours
 */
export function spellLines(spells, ours) {
  return (spells ?? []).filter((s) => ours.has(s.bowlerId)).map((s) => {
    const over = s.maxSpell != null && s.overs > s.maxSpell;
    const base = `${s.name}: ${s.overs} over${s.overs === 1 ? "" : "s"}`;
    return { key: `${s.innings}-${s.bowlerId}-${s.spellNo}`, innings: s.innings, bowlerId: s.bowlerId,
      text: over ? `${base}; the directive allowed ${s.maxSpell}${s.breachRecorded ? "; a breach is on record" : ""}` : base };
  });
}

/** Overs as the log says them, re-exported so the tab and the rules share one spelling. */
export { oversOf };
