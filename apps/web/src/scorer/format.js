import { isWicketBall } from "@scrbrd/scoring";

/* ═══════════════════════════════════════════════════════
   SCORECARD
═══════════════════════════════════════════════════════ */
const SR=(r,b)=>b===0?"—":((r/b)*100).toFixed(1);

const RR=(r,b)=>b===0?"—":((r/(b/6))||0).toFixed(2);

const fmtOv=b=>`${Math.floor(b/6)}.${b%6}`;

/**
 * Is this ball a dismissal? A W, or a wicket on a wide or a no-ball (Law 22.9,
 * 21.17: isWicketBall()). A wicket the free hit saved keeps its type in the
 * log, with `freeHitSaved` set (replay.mjs), and the batter is not out: it is
 * drawn and counted as the runs it made, never as a W.
 * @param {{type?: string, dismissal?: unknown, freeHitSaved?: boolean} | null | undefined} b
 */
const isOut=(b)=>isWicketBall(b)&&!b?.freeHitSaved;

export { RR, SR, fmtOv, isOut };
