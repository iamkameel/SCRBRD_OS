import { deriveInningsList } from "@scrbrd/scoring";
import { inningsInPlay } from "@scrbrd/sync";
import { isSuperOver, pairPlace } from "../lib/superOver.js";

/**
 * Where the pad's log opens (SCRBRD-114 phase 3b): the innings in play
 * (packages/sync inningsInPlay()), or — when that is a super over's first
 * innings already sealed — the place its chase will take, as the match's own
 * first innings does. Here and not in lib/superOver.js because it reads the
 * sync package, which the public page's bundle must not pull in.
 * @param {any[][]} log  the pad's log, one array per innings
 * @param {object} ctx   the fold's context
 * @returns {number}
 */
export function resumeAt(log, ctx) {
  const i = inningsInPlay(log);
  const inns = deriveInningsList(log, ctx);
  const inn = inns[i];
  return isSuperOver(inn) && inn.sealed && pairPlace(inns, i) === "first" ? i + 1 : i;
}
