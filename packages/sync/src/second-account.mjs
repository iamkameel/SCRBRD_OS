/**
 * Two phones scoring one match: the words each scorer reads
 * (docs/design/TWO_PHONES.md R3, slice 1; Kameel, 5 Nov 2026).
 *
 * The pen's book is the match's; a phone that scored without the pen holds a
 * second scorer's book, which is kept whole and set aside on the server for
 * review, never merged (R1). Both scorers are told, in a sheet and not a
 * toast, in the pad's own voice, with no person and no child named:
 *
 *   the second phone, at reconnect (a fork, or balls set aside):
 *     "Another phone scored this match while this one had no signal.
 *      22 balls on this phone are not in the match record. They are kept
 *      here and set aside on the server for review — nothing was lost, and
 *      none of them was added to the score. Someone who approves corrections
 *      will compare the two accounts."
 *   the pen-holder, at the next sync after a second account lands:
 *     "Your scoring stands · 22 balls from another phone set aside for review"
 *     with a tap to the same words, said of the other phone.
 *
 * Pure, so the words are tested without a DOM (test/second-account.test.mjs).
 */
import { KIND } from "@scrbrd/scoring";
import { waitingPhrase } from "./attach.mjs";

const LEAD = "Another phone scored this match while this one had no signal.";
const REVIEW = "Someone who approves corrections will compare the two accounts.";

/** @param {number} n */
const balls = (n) => `${n} ball${n === 1 ? "" : "s"}`;

/**
 * What the second phone reads: the balls it kept that the match record does
 * not have ("22 balls"); a phone that kept no ball says what it kept ("2
 * changes to the scorebook").
 * @param {{payload?: any}[]} items  this phone's events not in the match record
 * @returns {{lead: string, text: string, count: string, balls: number}}
 */
export function secondAccountWords(items) {
  // R3 counts balls: a kept over change or innings start is set aside with
  // them, but "22 balls" is what the scorer recorded and will recognise.
  // Only a phone that kept no ball at all says what it did keep.
  const n = items.filter((e) => (e?.payload?.kind ?? KIND.BALL) === KIND.BALL).length;
  const count = n ? balls(n) : waitingPhrase(items);
  const one = n ? n === 1 : items.length === 1;
  return {
    lead: LEAD,
    count,
    balls: n,
    text: `${count} on this phone ${one ? "is" : "are"} not in the match record. `
      + `${one ? "It is" : "They are"} kept here and set aside on the server for review — nothing was lost, and `
      + `${one ? "it was not" : "none of them was"} added to the score. ${REVIEW}`,
  };
}

/**
 * The pen-holder's line in the session badge.
 * @param {number} n  balls from another phone set aside, undecided (db/135 second_account_waiting)
 * @returns {string}
 */
export function penStandsLine(n) {
  return `Your scoring stands · ${balls(n)} from another phone set aside for review`;
}

/**
 * The same words, as the pen-holder reads them when he taps the line: of the
 * other phone, not of his own.
 * @param {number} n
 * @returns {{lead: string, text: string}}
 */
export function penStandsWords(n) {
  const one = n === 1;
  return {
    lead: "Another phone scored this match while it had no signal.",
    text: `${balls(n)} from it ${one ? "is" : "are"} not in the match record. `
      + `${one ? "It is" : "They are"} kept on that phone and set aside on the server for review — nothing was lost, and `
      + `${one ? "it was not" : "none of them was"} added to the score. Your scoring stands. ${REVIEW}`,
  };
}
