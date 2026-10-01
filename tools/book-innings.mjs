/**
 * An innings from a paper scorebook, written as scorebook_import_commit()
 * writes it (SCRBRD-120, db/63), for the walks that need one on screen.
 *
 * The API walk (smoke-scorebook.mjs) commits a real import through the
 * routes. The browser walks only need the RESULT — a complete match whose
 * one innings is start → summary → end, the summary through the commit's
 * door (the schema owner, naming the import) — so this writes those three
 * events directly, the way tools/smoke-fold-figures.mjs does, and returns
 * the match. Imported by the walks; not a walk itself.
 */
import { inningsStart, inningsSummary, inningsEnd, toRow } from "@scrbrd/scoring";
import { baseCard, TYPED } from "../packages/scoring/test/scorebook-cards.mjs";

/**
 * A home batting card in which the book left balls, fours and sixes blank for
 * the listed batting orders (1-based), on top of the standard card that adds
 * up (127 for 4 off 20 overs).
 * @param {string[]} players  six player ids of the batting side, batting order
 * @param {number[]} [blank]  batting orders whose balls, fours and sixes the book left blank
 */
export function bookCard(players, blank = []) {
  const card = baseCard(players);
  for (const b of card.batting) if (blank.includes(b.order)) Object.assign(b, { balls: null, fours: null, sixes: null });
  return card;
}

/**
 * Write one complete match with one summarised innings.
 * @param {import("pg").Pool} pool  connected as the schema owner
 * @param {{ school: string, team?: string, opponent?: string, daysAgo?: number, startsAt?: string, card: any, scorerUserId: string,
 *           typed?: Record<string, string>, ours?: string, squad?: { id: string, name: string }[] }} o
 *   `startsAt`, an explicit instant, wins over `daysAgo` (a walk's fixture takes a date, never the clock);
 *   `squad`, the batting side as innings_start carries it ({ id, name }), names the card's rows.
 * @returns {Promise<string>} the match id
 */
export async function writeBookInnings(pool, { school, team = "1XI", opponent = "Book XI", daysAgo = 0, startsAt = null, card, scorerUserId, typed = TYPED, ours = "Book side", squad = undefined }) {
  const imp = crypto.randomUUID();
  const source = { kind: "scorebook", import: imp, checkedBy: scorerUserId, confirmedBy: scorerUserId };
  const evs = [
    { ev: { ...inningsStart({ battingTeam: ours, bowlingTeam: opponent, overs: 20, ...(squad ? { squad } : {}) }), innings: 0, id: `scorebook:${imp}:0:start`, source }, device: "device-book" },
    { ev: { ...inningsSummary({ card, typed, source }), innings: 0, id: `scorebook:${imp}:0:summary` }, device: `scorebook:${imp}` },
    { ev: { ...inningsEnd({ reason: "overs_complete", confirmed: { runs: card.total, wickets: card.wickets, balls: 120 } }),
            innings: 0, id: `scorebook:${imp}:0:end`, source }, device: "device-book" },
  ];
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('scrbrd.scorebook_commit', $1, true)", [imp]);
    const match = (await c.query(
      `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
       values ($1, $2, $3, coalesce($5::timestamptz, now() - ($4 || ' days')::interval), 'T20', 20, 'complete') returning id`,
      [school, team, opponent, String(daysAgo), startsAt])).rows[0].id;
    let seq = 0;
    for (const { ev, device } of evs) {
      const r = toRow(ev);
      seq++;
      await c.query(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                             client_seq, client_ts, kind, payload)
                     values ($1, $2, $3, 1, $4, $5, $6, $7, $3, $8, $9, $10)`,
        [match, school, seq, r.innings, scorerUserId, device, ev.id, r.client_ts, r.kind, JSON.stringify(r.payload)]);
    }
    await c.query("COMMIT");
    return match;
  } catch (err) { await c.query("ROLLBACK").catch(() => {}); throw err; } finally { c.release(); }
}
