/**
 * WHAT A CORRECTION WOULD DO, BEFORE ANYONE DECIDES IT (GA-I36 A1, design §5
 * "the approver", §8 A1): the effect, computed here by folding the log the
 * reader already has with the change applied — the void appended, or the
 * held ball appended at the end of the log, where a release writes it (db/14,
 * Q5) — beside the fold as it stands. The server writes nothing until the
 * approver says so, and judges the change by the Laws when he does; this is
 * the preview he decides with, in the fold's own words.
 *
 * Signed-in only (the Corrections sheet and the staff correction lines): the
 * public page never imports it.
 *
 * Pure, so apps/web/test proves it under plain node.
 */
import { deriveMatch } from "@scrbrd/scoring";
import { deriveCommentary } from "@scrbrd/scoring/commentary";
import { oversOf, resultText, teamOf } from "./matchCentre.js";

/** The log's head: the largest seq in it, 0 for none. @param {any[]} events */
export const headOf = (events = []) => events.reduce((m, e) => Math.max(m, Number(e?.seq) || 0), 0);

/** @param {any} inn */
const figure = (inn) => `${inn.runs}/${inn.wickets} (${oversOf(inn.balls)})`;

/**
 * The change folded in, as the server would write it: a void at the next seq
 * naming the target, or the held ball at the next seq.
 * @param {any[]} events
 * @param {{kind: "void", target: string, innings: number} | {kind: "release", event: any}} change
 */
export function applied(events, change) {
  const seq = headOf(events) + 1;
  const ev = change.kind === "void"
    ? { kind: "void", innings: change.innings ?? 0, target: change.target, seq, id: `preview:${seq}`, clientTs: 0 }
    : { ...change.event, kind: change.event?.kind ?? "ball", innings: change.event?.innings ?? 0, seq, id: change.event?.id ?? `preview:${seq}`, clientTs: 0 };
  return [...events, ev];
}

/**
 * The effect, in words: each innings whose figure moves, "Hilton 164/7 (20)
 * → 160/7 (20)", and the result: unchanged, or the words before and after.
 * @param {{match: any, events: any[], fold?: any, change: Parameters<typeof applied>[1]}} o
 * @returns {{innings: {team: string, before: string, after: string}[], same: boolean,
 *            result: {before: string | null, after: string | null, changes: boolean}, words: string[]}}
 */
export function effectOf({ match, events, fold = {}, change }) {
  const a = deriveMatch(events, fold);
  const b = deriveMatch(applied(events, change), fold);
  const innings = [];
  for (let i = 0; i < Math.max(a.innings.length, b.innings.length); i++) {
    const x = a.innings[i], y = b.innings[i];
    if (!x && !y) continue;
    const before = x ? figure(x) : "no innings", after = y ? figure(y) : "no innings";
    if (before !== after) innings.push({ team: teamOf(match, (y ?? x).battingTeam).full, before, after });
  }
  const rb = resultText(match, a.result), ra = resultText(match, b.result);
  const result = { before: rb, after: ra, changes: rb !== ra };
  const words = [
    ...(innings.length ? innings.map((r) => `${r.team} ${r.before} → ${r.after}`) : ["No figure moves"]),
    result.changes ? `Result changes: ${rb ?? "no result yet"} → ${ra ?? "no result yet"}` : "Result unchanged",
  ];
  return { innings, same: innings.length === 0, result, words };
}

/**
 * A ball as the commentary tells it, with its place: "12.4 · Visser to D
 * Erasmus, FOUR…". Told from the log with any void of it taken out, so a ball
 * already corrected can still be named in the line that says so.
 * @param {{events: any[], fold?: any, target: string, nameOf?: (ref: string) => string | null | undefined, teamName?: (key: any, name: string) => string}} o
 * @returns {{over: number, ball: number, text: string, words: string} | null}
 */
export function ballLine({ events, fold = {}, target, nameOf, teamName }) {
  const log = events.filter((e) => !(e?.kind === "void" && e.target === target));
  const line = deriveCommentary(log, { ctx: fold, nameOf, teamName }).find((c) => c.key === `e:${target}`);
  return line ? { over: line.over, ball: line.ball, text: line.text, words: `${line.over}.${line.ball} · ${line.text}` } : null;
}
