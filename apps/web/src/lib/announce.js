import { BALL_TYPE, DISMISSAL_LABEL, normaliseDismissal, isWicketBall } from "@scrbrd/scoring";

/**
 * A ball, said aloud (WCAG 4.1.3) — the words the spectator pages share.
 *
 * One place for what the Match Centre's moment ("Four", "Six", "Wicket") and
 * the public page's live region say, so the two cannot drift: spectator.jsx
 * draws BEAT_WORD and overSummaryText; the public page's region announces the
 * same words, plainly, as each ball arrives.
 *
 * Pure: no React, no DOM. Names nobody: a delivery is told by what happened
 * to the score, never by who — which is also why the public page, whose log
 * carries pseudonyms and only some names, can say all of it.
 */

/** The beat on the board for a four, a six and a wicket. */
export const BEAT_WORD = Object.freeze({ four: "Four", six: "Six", wicket: "Wicket" });

/** "End of over 5: 9 runs. Hilton College 1XI 48/2." — the generator's own line, its first two sentences. */
export const overSummaryText = (item) => (item?.text ?? "").split(/(?<=\.)\s+/).slice(0, 2).join(" ");

const NUMBER = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const num = (n) => NUMBER[n] ?? String(n);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const runs = (n) => `${num(n)} ${n === 1 ? "run" : "runs"}`;

/** The kinds of commentary line that are announced: a delivery, and the end of an over. */
const DELIVERY = new Set(["ball", "four", "six", "wicket"]);

/**
 * More than this many announceable lines arriving in one read is a gap — the
 * tab was hidden, or the phone lost signal — not play, and the page stays
 * quiet rather than call out a ball that is minutes old.
 */
export const CATCH_UP = 8;

/**
 * One delivery, in plain words: "Four runs", "Wicket — bowled", "Wide",
 * "No ball", "Two runs", "Dot ball".
 * @param {{kind: string}} item  the commentary line (its kind decides four, six, wicket)
 * @param {any} [ev]  the ball event it was told from, where the log has it
 */
export function ballWords(item, ev) {
  const type = ev?.type ?? BALL_TYPE.RUN;
  const v = Number.isInteger(ev?.value) ? ev.value : 0;
  if (item.kind === "wicket") {
    const how = DISMISSAL_LABEL[/** @type {keyof typeof DISMISSAL_LABEL} */ (normaliseDismissal(ev?.dismissal) ?? "")];
    return how ? `Wicket — ${how.toLowerCase()}` : "Wicket";
  }
  // A wicket the free hit saved is not a wicket, and is not called one —
  // a W, or a stumping off a wide on a free hit (isWicketBall()).
  if (isWicketBall(ev)) return type === BALL_TYPE.WIDE ? "Wide. Free hit: not out" : "Free hit: not out";
  if (type === BALL_TYPE.WIDE) return v > 0 ? `Wide, and ${num(v)} more` : "Wide";
  if (type === BALL_TYPE.NO_BALL) return item.kind === "four" || item.kind === "six" ? `No ball, ${runs(item.kind === "six" ? 6 : 4)}` : "No ball";
  if (type === BALL_TYPE.BYE) return v > 0 ? `${cap(num(v))} ${v === 1 ? "bye" : "byes"}` : "Dot ball";
  if (type === BALL_TYPE.LEG_BYE) return v > 0 ? `${cap(num(v))} leg ${v === 1 ? "bye" : "byes"}` : "Dot ball";
  if (item.kind === "six" || v === 6) return `${BEAT_WORD.six} runs`;
  if (item.kind === "four" || v === 4) return `${BEAT_WORD.four} runs`;
  return v === 0 ? "Dot ball" : cap(runs(v));
}

/**
 * What the live region should say for the lines that have just arrived: the
 * latest delivery or the end of the latest over, or nothing. Only the newest
 * is told — a burst after a slow read is one call, not a replay — and a gap
 * (CATCH_UP) is told not at all.
 * @param {{kind: string, key: string, text?: string}[]} fresh  lines that were not there on the last read
 * @param {any[]} events  the log they were told from (ids match the lines' keys, "e:<id>")
 * @returns {string}
 */
export function announceArrivals(fresh, events) {
  const says = fresh.filter((c) => DELIVERY.has(c.kind) || c.kind === "over_end");
  if (!says.length || says.length > CATCH_UP) return "";
  /** The ball a delivery's line was told from. @param {{key: string}} c */
  const evOf = (c) => { const id = c.key.replace(/^e:/, "").replace(/#\d+$/, ""); return events.find((e) => e.id === id); };
  const last = says[says.length - 1];
  if (last.kind !== "over_end") return ballWords(last, evOf(last));
  // The over's summary comes with the next thing that happens, so the ball
  // that ended the over is often in the same read: say it first.
  const before = says.length > 1 ? says[says.length - 2] : null;
  return before && before.kind !== "over_end" ? `${ballWords(before, evOf(before))}. ${overSummaryText(last)}` : overSummaryText(last);
}
