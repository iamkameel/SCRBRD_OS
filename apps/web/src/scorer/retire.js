/**
 * The pad's side of a batter retiring hurt (Law 25.4.2; SCRBRD-071): what
 * its sheet asks, with no React in it.
 *
 * THE FLOW. "Batter retired hurt" on the pad's menu — never an interrupt
 * (DESIGN_DIRECTION §1a): which batter, the striker or the non-striker, by
 * name; then `retire({batter, reason: "hurt"})`, the builder in events.mjs,
 * with no `type: "W"` — so it is not a wicket, and nothing that counts
 * wickets counts it; then at once the batting-order sheet for whoever comes
 * in at the end he left. It works mid-over: nothing about the over moves.
 *
 * The fold (replay.mjs) marks him "retired hurt", not out; his partnership
 * ends and his figures stop. When he walks back in — the batting-order sheet
 * lists him under "Retired hurt — may resume" — his line goes on.
 *
 * WHO MAY RESUME is the Laws' answer too (resumeChoices below): only once a
 * wicket has fallen, or another batter has retired, since he went off — so
 * never straight back into the end he has just left. The sheet lists exactly
 * the retired batters the Laws would take at the end it is filling, by no
 * rule of its own: it used to leave out only "the one who has just retired",
 * a rule of the pad's that the server did not share.
 *
 * THE QUESTION is lawsRefusal()'s, over the fold the pad already holds: the
 * same function the server asks at commit, so a batter this sheet offers is
 * one the server takes. A retirement of someone who is not at the crease is
 * refused (not_at_crease). Refusals are said in words, with no Law clause
 * numbers (Kameel is verifying them against the current Code).
 */
import { REFUSAL, RETIRE_REASON, batters, lawsRefusal, retire } from "@scrbrd/scoring";
import { refusalWords } from "./penalty.js";

/**
 * The event the sheet sends. Retired hurt, never a dismissal: retire() adds
 * the wicket marker only for retired out and timed out.
 * @param {number} curIn
 * @param {string | null} batter
 */
export const retireHurtEvent = (curIn, batter) =>
  retire({ innings: curIn, batter: /** @type {string} */ (batter), reason: RETIRE_REASON.HURT });

/**
 * Why the Laws would refuse this retirement, or null. `match` is `{innings,
 * events}`, as lawsRefusal takes it.
 * @param {{innings: any[], events?: any[][]}} match
 * @param {number} curIn
 * @param {string | null | undefined} batter
 */
export function retireRefusal(match, curIn, batter) {
  return lawsRefusal(match, retireHurtEvent(curIn, batter ?? null));
}

/** The pad's words for a refusal on this sheet: present tense, no clause numbers. */
const SHEET_WORDS = Object.freeze({
  [REFUSAL.NOT_AT_CREASE]: "He is not at the crease. Only a batter who is in can retire.",
  [REFUSAL.NO_INNINGS]: "Nobody has said who is batting in this innings yet.",
  [REFUSAL.LATER_INNINGS_STARTED]: "A later innings has already started.",
  [REFUSAL.RESUME_NOT_YET]: "He can resume only once a wicket has fallen or another batter has retired.",
  [REFUSAL.CONSENT_NOT_RETIRED_OUT]: "The opposing captain's consent is only for a batter who retired out.",
});

/** @param {string | null | undefined} code  a lawsRefusal() answer */
export function retireRefusalWords(code) {
  if (!code) return null;
  return SHEET_WORDS[code] ?? refusalWords(code);
}

/**
 * Whom the sheet offers: the striker, then the non-striker, each by name
 * with his figures, and the Laws' answer for each.
 *
 * @param {{innings: any[], events?: any[][]}} match  the pad's fold and log
 * @param {number} curIn
 * @returns {{id: string, name: string, end: "striker" | "nonStriker", runs: number, balls: number, code: string | null, words: string | null}[]}
 */
export function retireChoices(match, curIn) {
  const inn = match.innings?.[curIn] ?? null;
  /** @type {ReturnType<typeof retireChoices>} */
  const out = [];
  for (const [end, id] of /** @type {const} */ ([["striker", inn?.striker], ["nonStriker", inn?.nonStriker]])) {
    if (id == null) continue;
    const b = inn?.batsmen?.find((/** @type {any} */ x) => x.id === id);
    const code = retireRefusal(match, curIn, id);
    out.push({ id, name: b?.name ?? String(id), end, runs: b?.runs ?? 0, balls: b?.balls ?? 0, code, words: retireRefusalWords(code) });
  }
  return out;
}

/** Which end, in words, for the sheet. */
export const END_WORDS = Object.freeze({ striker: "On strike", nonStriker: "Non-striker" });

/**
 * The event the batting-order sheet sends when a retired batter walks back
 * in: to the striker's end when it is empty, else the non-striker's — the
 * pad's addBatsman() rule for the end that needs filling. `asStriker` says
 * otherwise, for a sheet that always sends to the striker's end. `consent`:
 * a batter who retired out, back with the opposing captain's consent.
 * @param {{innings: any[], events?: any[][]}} match
 * @param {number} curIn
 * @param {string} id
 * @param {boolean} [asStriker]
 * @param {boolean} [consent]
 */
export function resumeEvent(match, curIn, id, asStriker, consent = false) {
  const inn = match.innings?.[curIn] ?? null;
  const striker = asStriker ?? inn?.striker == null;
  return batters({ innings: curIn, ...(striker ? { striker: id } : { nonStriker: id }), ...(consent ? { captainConsent: true } : {}) });
}

/**
 * Why the Laws would refuse this batter walking back in, or null.
 * @param {{innings: any[], events?: any[][]}} match
 * @param {number} curIn
 * @param {string} id
 * @param {boolean} [asStriker]
 * @param {boolean} [consent]
 */
export function resumeRefusal(match, curIn, id, asStriker, consent = false) {
  return lawsRefusal(match, resumeEvent(match, curIn, id, asStriker, consent));
}

/**
 * Whom the batting-order sheet offers under "Retired hurt — may resume": the
 * batters retired and not out whom the Laws would take back now, at the end
 * the sheet fills. A retirement the Laws read as out (an old unmarked
 * "retired out") is refused as out; one who went off with no wicket and no
 * other retirement since is refused as too soon.
 * @param {{innings: any[], events?: any[][]}} match
 * @param {number} curIn
 * @param {boolean} [asStriker]
 * @returns {any[]}  the fold's batter lines
 */
export function resumeChoices(match, curIn, asStriker) {
  const inn = match.innings?.[curIn] ?? null;
  return (inn?.batsmen ?? []).filter((/** @type {any} */ b) => b.status === "retired" && resumeRefusal(match, curIn, b.id, asStriker) === null);
}

/**
 * Whom the batting-order sheet offers under "Retired out — may resume with
 * the opposing captain's consent" (Law 25.4.3): the batters retired out whom
 * the Laws would take back now, with consent, at the end the sheet fills —
 * once a wicket has fallen or another batter has retired since he went. The
 * sheet asks the scorer to confirm the captain agreed before it sends.
 * @param {{innings: any[], events?: any[][]}} match
 * @param {number} curIn
 * @param {boolean} [asStriker]
 * @returns {any[]}  the fold's batter lines
 */
export function consentChoices(match, curIn, asStriker) {
  const inn = match.innings?.[curIn] ?? null;
  return (inn?.batsmen ?? []).filter((/** @type {any} */ b) => b.status === "out" && b.dismissal === "retired out"
    && resumeRefusal(match, curIn, b.id, asStriker, true) === null);
}
