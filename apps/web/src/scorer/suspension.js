/**
 * The pad's side of a bowler suspended by the umpires (Law 41; SCRBRD-094
 * item 2) — what the sheet asks, with no React in it.
 *
 * THE FLOW. "Umpire suspended the bowler" on the pad's menu: the reason, in
 * words — the scope is the reason's, not a choice — then the event
 * (bowlerSuspended()), then at once the man who finishes the over (a
 * `bowler` event, reason "suspended"), offered only from the bowlers the
 * Laws would take, the others listed with why not. At the end of an over
 * there is nobody to finish it: the next over's bowler is asked instead.
 *
 * THE QUESTIONS are lawsRefusal()'s, over the fold the pad already holds —
 * the same function the server asks at commit, so a bowler this sheet offers
 * is one the server takes. No Law clause numbers on any of it (Kameel is
 * verifying them against the current Code).
 *
 * THE REPORT. The umpires report a suspension after the match (to the
 * competition, and the school keeps it as a discipline record, db/25). The
 * pad does not build a report of its own: it offers the existing discipline
 * flow (views/discipline.jsx ReportIncident) with the bowler and the words
 * filled in — reportFor() below.
 */
import {
  SUSPENSION_REASON, SUSPENSION_REASON_TEXT, SUSPENSION_SCOPE_TEXT, REFUSAL,
  bowlerSuspended, bowler, isMidOver, lawsRefusal, fmtOvers,
} from "@scrbrd/scoring";
import { refusalWords } from "./penalty.js";
import { lawsEdition, suspensionScope } from "@scrbrd/scoring";

const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The reasons, in the order the sheet offers them. */
export const SUSPENSION_REASONS_OFFERED = Object.freeze(Object.values(SUSPENSION_REASON));

/** A reason in words, for a button. */
export const suspensionReasonWords = (reason) => upperFirst(SUSPENSION_REASON_TEXT[reason] ?? String(reason ?? ""));

/**
 * How long it is for, in words, for the reason chosen, under the Edition of
 * the Laws the match is scored under (SCRBRD-113): "for the rest of the
 * innings", or — a deliberate front-foot no-ball or a deliberate beamer from
 * 1 October 2026, ball tampering, a Level 4 conduct offence — "for the rest
 * of the match". `edition` is lawsEdition(match).
 * @param {string} reason  @param {3 | 4} edition
 */
export const scopeWords = (reason, edition) => SUSPENSION_SCOPE_TEXT[suspensionScope(reason, edition)];

/** How long a suspension already recorded is for, in words: the scope it carries. */
export const recordedScopeWords = (scope) => SUSPENSION_SCOPE_TEXT[scope] ?? SUSPENSION_SCOPE_TEXT.innings;

/**
 * The bowler a suspension now would be of: the one on, or — the ball dead on
 * the last of an over, nobody on yet — the one who bowled the last delivery.
 * The Laws take nobody else (NOT_BOWLING).
 * @param {any} inn  the pad's fold of this innings
 * @returns {string | null}
 */
export function bowlerToSuspend(inn) {
  if (!inn) return null;
  if (inn.bowler != null) return inn.bowler;
  const log = inn.ballLog ?? [];
  return log[log.length - 1]?.bowlerId ?? null;
}

/**
 * The event the sheet sends: the scope is the reason's under the match's
 * Edition (`edition`, lawsEdition(match)) — the one the server will demand.
 */
export const suspendEvent = (curIn, bowlerId, reason, edition) => bowlerSuspended({ innings: curIn, bowler: bowlerId, reason, edition });

/**
 * Why the Laws would refuse this suspension, or null. `match` is `{innings,
 * events}`, as lawsRefusal takes it. Before a reason is chosen, the bowler
 * alone is judged (any reason on the list says the same about him).
 */
export function suspendRefusal(match, curIn, bowlerId, reason) {
  return lawsRefusal(match, suspendEvent(curIn, bowlerId, reason ?? SUSPENSION_REASON.BEAMERS, lawsEdition(match)));
}

/** The pad's words for a refusal on this sheet: present tense, no clause numbers. */
const SHEET_WORDS = Object.freeze({
  [REFUSAL.NOT_BOWLING]: "Nobody is bowling to be suspended yet.",
  [REFUSAL.BOWLER_SUSPENDED]: "Suspended by the umpires. He may not bowl again this innings, or, for some offences, this match.",
  [REFUSAL.CONSECUTIVE_OVERS]: "Bowled part of the last over. He may not bowl this one.",
  [REFUSAL.SUSPENSION_UNKNOWN]: "The scorebook does not know that reason.",
  [REFUSAL.MID_OVER_NO_REASON]: "A change during an over needs its reason.",
});

/** @param {string | null | undefined} code  a lawsRefusal() answer */
export function suspensionRefusalWords(code) {
  if (!code) return null;
  return SHEET_WORDS[code] ?? refusalWords(code);
}

/**
 * Who could bowl now, and who not, with why. `candidates` are {id, name};
 * each is asked of the Laws as the bowler event the sheet would send — with
 * reason "suspended" while an over is under way (another finishes it), with
 * none at an over's start.
 *
 * @param {{innings: any[], events: any[][]}} match  the pad's fold and log
 * @param {number} curIn
 * @param {{id: string, name: string}[]} candidates
 * @returns {{midOver: boolean, eligible: {id: string, name: string}[], refused: {id: string, name: string, code: string, words: string}[]}}
 */
export function replacementOptions(match, curIn, candidates) {
  const inn = match.innings?.[curIn] ?? null;
  const midOver = isMidOver(inn);
  const eligible = [], refused = [];
  const seen = new Set();
  for (const c of candidates) {
    if (c?.id == null || seen.has(c.id)) continue;
    seen.add(c.id);
    const code = lawsRefusal(match, replacementEvent(curIn, c.id, midOver));
    if (code) refused.push({ ...c, code, words: /** @type {string} */ (suspensionRefusalWords(code)) });
    else eligible.push(c);
  }
  return { midOver, eligible, refused };
}

/** The bowler event for whoever takes the ball after a suspension. */
export const replacementEvent = (curIn, id, midOver) =>
  bowler({ innings: curIn, bowler: id, ...(midOver ? { reason: "suspended" } : {}) });

/**
 * Whom the sheet offers: everyone who has bowled this innings, then the
 * fielding squad — the ids the events carry, the names the scorecard shows.
 * @param {any} inn
 * @returns {{id: string, name: string}[]}
 */
export function bowlingCandidates(inn) {
  const entry = (p) => (typeof p === "string" ? { id: p, name: p } : { id: p?.id ?? p?.name, name: p?.name ?? p?.id });
  return [...(inn?.bowlers ?? []).map((b) => ({ id: b.id, name: b.name })), ...(inn?.bowlingSquad ?? []).map(entry)]
    .filter((c) => c.id != null);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every suspension in the match, for the umpires' report: who, why, how
 * long, where, and what the discipline record would say. `playerId` only for
 * a player SCRBRD holds a row for — a typed name has no record to file
 * against, and the sheet says so.
 * @param {any[]} innings  the pad's fold
 * @returns {{key: string, innings: number, bowler: string, name: string, playerId: string | null, reason: string, scope: string, at: string, body: string}[]}
 */
export function suspensionsInMatch(innings) {
  const out = [];
  (innings ?? []).forEach((inn, i) => {
    for (const [k, s] of (inn?.suspensions ?? []).entries()) {
      const name = inn.bowlers?.find((b) => b.id === s.bowler)?.name
        ?? (inn.bowlingSquad ?? []).find((p) => (p?.id ?? p) === s.bowler)?.name ?? String(s.bowler);
      const at = `over ${fmtOvers(s.over * 6 + s.ballInOver)}`;
      const why = SUSPENSION_REASON_TEXT[s.reason] ?? s.reason;
      const long = SUSPENSION_SCOPE_TEXT[s.scope] ?? SUSPENSION_SCOPE_TEXT.innings;
      out.push({
        key: `${i}:${k}`, innings: i, bowler: s.bowler, name,
        playerId: typeof s.bowler === "string" && UUID.test(s.bowler) ? s.bowler : null,
        reason: s.reason, scope: s.scope, at,
        body: `Suspended from bowling by the umpires in innings ${i + 1}, at ${at}, for ${why}. `
          + `He may not bowl again ${long}. The umpires report this to the competition.`,
      });
    }
  });
  return out;
}
