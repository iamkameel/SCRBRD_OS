/**
 * An amendment re-judges who faced (Kameel, 28 Oct 2026, the Laws audit Q5,
 * F4).
 *
 * The fold never reads the striker the pad stamped on a ball: it tracks the
 * crease itself (replay.mjs). So when an approved amendment voids an OLDER
 * delivery — a single that was a dead ball — the fold replays every ball after
 * it and may put a different batter on strike for each. SQL's careers read
 * the stamp (ball_event.striker_id), and the two disagreed: the scorecard
 * said A made the four, his career said B. Kameel: the server follows the
 * corrected order. The balls after the corrected one in its innings are
 * re-judged, and SQL reads the fold's answer, not the pad's.
 *
 * This is the fold's half: rejudgedStrikers() says, for the balls after the
 * amendment's target in its innings, which striker the fold now gives where
 * it is not the stamp. The amendment route hands that to
 * scoring_amendment_rejudge() (db/121), in the transaction that approved it,
 * and ball_event_live reads the result. tools/smoke-fold-figures.mjs holds
 * every career reader to the fold after such a void.
 */
import { MatchFold, fromRow, isPlayerId } from "@scrbrd/scoring";

/**
 * The balls after `afterSeq` in `innings` whose striker, as the fold gives it
 * over the log `rows` (the match's ball_event rows in seq order, voids
 * included), is not the one stamped on the row. A striker SCRBRD holds no row
 * for — a typed name — is `null`, as ball_event.striker_id has it. A ball the
 * fold has nobody on strike for is left as stamped.
 *
 * @param {Record<string, any>[]} rows
 * @param {import("@scrbrd/scoring").FoldContext} ctx
 * @param {{innings: number, afterSeq: number}} where
 * @returns {{seq: number, striker_id: string | null}[]}
 */
export function rejudgedStrikers(rows, ctx, { innings, afterSeq }) {
  const view = new MatchFold(rows.map(fromRow), ctx).view();
  const inn = view.innings[innings];
  /** @type {Map<number, string | null>} */
  const stamped = new Map();
  for (const r of rows) if (r.kind === "ball" && r.innings === innings && r.seq > afterSeq) stamped.set(r.seq, r.striker_id ?? null);
  /** @type {{seq: number, striker_id: string | null}[]} */
  const out = [];
  for (const e of inn?.ballLog ?? []) {
    const seq = /** @type {any} */ (e).seq;
    if (typeof seq !== "number" || !stamped.has(seq)) continue;
    // A fold that does not know who is on strike (no batters event before
    // the ball: a log written by hand, or from elsewhere) re-judges nothing:
    // the stamp is the only word there is.
    if (e.strikerId == null) continue;
    const faced = isPlayerId(e.strikerId) ? /** @type {string} */ (e.strikerId).toLowerCase() : null;
    const stamp = stamped.get(seq);
    if (faced !== (stamp == null ? null : String(stamp).toLowerCase())) out.push({ seq, striker_id: faced });
  }
  return out;
}

/**
 * After an approval wrote its void (the amendment route, under the per-match
 * lock): fold the match's whole log and re-judge the balls after the
 * amendment's target. Inside the caller's transaction, as the approver.
 * Returns the rows written.
 *
 * @param {{query: (text: string, params?: unknown[]) => Promise<{rows: any[]}>}} client
 * @param {string} amendmentId
 * @param {string} matchId
 * @param {string} columns  the event columns the route reads (EVENT_COLUMNS)
 * @param {import("@scrbrd/scoring").FoldContext} ctx
 * @returns {Promise<number>}
 */
export async function rejudgeAfterAmendment(client, amendmentId, matchId, columns, ctx) {
  const { rows: am } = await client.query(`select target_key from scoring_amendment where id = $1`, [amendmentId]);
  const targetKey = am[0]?.target_key;
  if (!targetKey) return 0;
  const { rows } = await client.query(`select ${columns} from ball_event where match_id = $1 order by seq`, [matchId]);
  const target = rows.find((r) => r.idempotency_key === targetKey);
  if (!target) return 0;
  const changed = rejudgedStrikers(rows, ctx, { innings: target.innings, afterSeq: target.seq });
  const { rows: out } = await client.query(`select scoring_amendment_rejudge($1, $2::jsonb) as n`, [amendmentId, JSON.stringify(changed)]);
  return Number(out[0]?.n ?? 0);
}
