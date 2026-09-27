/**
 * SCRBRD — what probably happened, when the Laws check refuses.
 *
 * REFUSAL_TEXT (laws.mjs) says WHAT was refused: "nobody had been named to
 * bowl the over". A scorer at the ground also needs a guess at WHY, in words,
 * where one is knowable from the fold: the pad closed the over after six
 * legal balls, and the umpire has not called it, so one of the six was
 * probably a wide or a no-ball recorded as a legal ball (DESIGN_DIRECTION
 * §1a: "errors say what probably happened and how to fix it").
 *
 * `likelyCause(code, ctx)` is that guess, or null when nothing useful can be
 * said. It is a sibling of REFUSAL_TEXT so the pad, the held sheet and anything
 * else that shows a refusal share the words. It reads the fold (`ctx.inn`, a
 * deriveInnings() state) and the refused event (`ctx.ev`) and changes nothing.
 * A cause that needs the innings is left out when the caller has none: the
 * held sheet, which shows refusals the server made against a log that has
 * since moved, passes only the event, and gets only what the event alone
 * supports.
 *
 * Rules for the words, which the tests hold them to:
 *   - a person's name only from the fold's own batters and bowlers, and never
 *     an id: where the fold has no name, a role ("the bowler");
 *   - no Law clause numbers (they are being checked against the current Code);
 *   - a question where it is a guess.
 */

/** @import { Innings } from "./replay.mjs" */

/**
 * A player's name as the fold has it, or `fallback`. Never an id: the fold
 * names a player it holds no squad row for by the id itself, and an id is
 * not a name a scorer can read.
 * @param {{batsmen?: {id: string, name: string}[], bowlers?: {id: string, name: string}[]} | null | undefined} inn
 *   a folded innings, or anything with its batters and bowlers
 * @param {string | null | undefined} id
 * @param {string} fallback  a role word: "the batter", "the bowler"
 * @returns {string}
 */
export function foldName(inn, id, fallback) {
  if (id == null) return fallback;
  const hit = inn?.batsmen?.find((b) => b.id === id) ?? inn?.bowlers?.find((b) => b.id === id);
  const name = typeof hit?.name === "string" ? hit.name.trim() : "";
  return name && !looksLikeAnId(name) ? name : fallback;
}

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const DEVICE_KEY_LIKE = /^[^\s:]+:[^\s:]+:/;   // newEventId(): device:match:time:seq
/** @param {string} s */
const looksLikeAnId = (s) => UUID_LIKE.test(s) || DEVICE_KEY_LIKE.test(s);

/**
 * The deliveries of the over the fold last closed: the six legal balls and
 * any wides and no-balls among them.
 * @param {Partial<Innings>} inn
 */
function lastOver(inn) {
  const balls = inn.balls ?? 0;
  if (balls === 0 || balls % 6 !== 0) return null;
  const over = balls / 6 - 1;
  const log = (inn.ballLog ?? []).filter((b) => b.over === over);
  return { number: over + 1, deliveries: log.length, extras: log.filter((b) => b.type === "Wd" || b.type === "Nb").length };
}

/**
 * @typedef {object} CauseContext
 * @property {Partial<Innings> | null} [inn]  the innings the refused event was for, as the fold has it now
 * @property {any} [ev]  the refused event, in the client's shape (events.mjs)
 */

/**
 * Each refusal's likely cause, where one is knowable. A function of the
 * context; null means "nothing to add to REFUSAL_TEXT".
 * @type {Readonly<Record<string, (ctx: CauseContext) => string | null>>}
 */
export const REFUSAL_CAUSE = Object.freeze({
  // The over is complete by the pad's count, and a ball is being recorded
  // anyway: the scorer's count and the umpire's differ.
  next_bowler: ({ inn }) => {
    const o = inn ? lastOver(inn) : null;
    if (!o) return null;
    return `${o.deliveries + 1} balls in this over? Six legal balls are already recorded in over ${o.number}. Was one of them a wide or no-ball?`;
  },
  next_batter: ({ inn }) => {
    const out = inn?.batsmen?.filter((b) => b.status === "out").at(-1);
    if (!inn || !out) return null;
    return `${foldName(inn, out.id, "A batter")} is out, and the next batter has not been named.`;
  },
  innings_over: ({ inn }) => {
    switch (inn?.endReason) {
      case "overs_complete": return `All ${inn.overs} overs have been bowled.`;
      case "all_out": return `All out: ${inn.wickets} wickets have fallen. If a wicket was recorded by mistake, undo it.`;
      case "target_reached": return `The target of ${inn.target} has been reached.`;
      default: return null;
    }
  },
  innings_closed: ({ inn }) => (inn?.sealed ? "The innings was confirmed closed at its review." : null),
  match_decided: () => "The chase has reached its target, so the result stands. Was the winning run recorded on another device?",
  later_innings_started: () => "The next innings has already started. Was it opened on another device?",
  previous_innings_open: () => "The innings before this one has not been closed. Confirm its review first.",
  consecutive_overs: ({ inn, ev }) => {
    const id = ev?.kind === "bowler" ? ev.bowler : inn?.bowler;
    const who = foldName(inn, id, "The same bowler");
    return `${who} bowled the last over. Was the new bowler named for the wrong over?`;
  },
  mid_over_no_reason: () => "The over is under way, so a change of bowler needs its reason: injury, or suspended.",
  same_batter_both_ends: () => "The same name was chosen for both ends.",
  batter_already_out: ({ inn, ev }) => {
    const id = ev?.striker ?? ev?.nonStriker ?? ev?.batter;
    return inn && id != null ? `${foldName(inn, id, "That batter")} is already out. Was it the other batter?` : null;
  },
  resume_not_yet: ({ inn, ev }) => {
    const id = [ev?.striker, ev?.nonStriker].find((x) => x != null && inn?.batsmen?.some((b) => b.id === x
      && (b.status === "retired" || (b.status === "out" && b.dismissal === "retired out"))));
    return inn && id != null
      ? `${foldName(inn, id, "That batter")} retired, and no wicket has fallen and nobody else has retired since. Was the next batter in meant?`
      : null;
  },
  consent_not_retired_out: () => "The opposing captain's consent is only for a batter who retired out. Was it recorded for the wrong batter?",
  crease_occupied: () => "A batter who is not out was replaced. Was the wicket recorded first?",
  not_at_crease: () => "That batter is not in. Was it the other one?",
  void_not_latest: () => "Something was recorded after it. Undo that first, or ask for an amendment.",
  void_already_voided: () => "It was already undone, perhaps on another device.",
  short_run_unmatched: () => "The five for short running go straight after that delivery, recorded with no runs.",
  penalty_reason_withdrawn: () => "An older copy of the pad offered that reason; the Laws do not give it. Award the runs again with another reason.",
});

/**
 * The likely cause of a refusal, in words, or null.
 * @param {string | null | undefined} code  a lawsRefusal() answer, or a held event's reason
 * @param {CauseContext} [ctx]
 * @returns {string | null}
 */
export function likelyCause(code, ctx = {}) {
  if (!code || !Object.hasOwn(REFUSAL_CAUSE, code)) return null;
  return REFUSAL_CAUSE[code]({ inn: ctx.inn ?? null, ev: ctx.ev ?? null }) ?? null;
}
