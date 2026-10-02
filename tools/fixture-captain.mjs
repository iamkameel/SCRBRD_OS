/**
 * The captain's view's fixtures (SCRBRD-138 phase A), for
 * tools/smoke-browser-pupil.mjs: two live Hilton 1XI matches written straight
 * onto the ball log through the scoring package's own constructors and
 * toRow() (as tools/fixture-matchcentre.mjs does), each under a frozen
 * playing-conditions document that caps a bowler at four overs.
 *
 *   FIELD — Hilton 1XI v Westville Boys' High 1XI, Westville batting. Fourteen
 *   overs bowled by Hilton: one bowler on four overs (at the cap), one on three
 *   (one over short), one on five (past it), one on two (nothing to say), and
 *   one who has not bowled.
 *
 *   BAT — the same fixture, Hilton batting, a wicket down: three have batted,
 *   so the next in is the sheet's fourth to sixth.
 *
 * Westville's players are typed names (a school SCRBRD does not host has no
 * roster); Hilton's are the seed's R Pillay and his team-mates, plus two
 * players inserted here. No child is real.
 */
import { inningsStart, batters, bowler, ball, placementFromTap, BALL_TYPE } from "@scrbrd/scoring";
import { writeEvents } from "./fixture-matchcentre.mjs";

/** The document the matches are played under: four overs a bowler, a free hit, and a band rule for open sides. */
export const PLAY = Object.freeze({
  "format.kind": "limited", "format.overs_per_innings": 20, "format.free_hit": true,
  "bowling.max_overs_per_bowler_innings": 4,
  "bowling.limit": { open: { spell: 6, day: 12 } },
});
const SOURCES = { "format.free_hit": { from: "set", status: "confirmed" }, "bowling.max_overs_per_bowler_innings": { from: "set", status: "confirmed" } };

/** Who bowled each of FIELD's fourteen overs: Naidoo four, Whitfield three, Bekker five, Seven two. */
export const ATTACK = Object.freeze(["naidoo", "whitfield", "naidoo", "bekker", "naidoo", "whitfield", "naidoo", "bekker", "whitfield", "bekker", "seven", "bekker", "seven", "bekker"]);
const OPP = ["Opp Alpha", "Opp Bravo", "Opp Charlie", "Opp Delta", "Opp Echo", "Opp Foxtrot"];

/**
 * Fix a match's playing conditions straight into match_conditions, as the
 * schema owner (the application role may not; the first event fixes it for a
 * real match).
 * @param {(text: string, params?: any[]) => Promise<any[]>} q  @param {string} matchId
 */
export async function fixConditions(q, matchId) {
  await q(`insert into match_conditions (match_id, doc, sources, doc_hash)
           values ($1, $2::jsonb, $3::jsonb, '')`,
    [matchId, JSON.stringify({ v: 1, play: PLAY, table: {}, sheet: {} }), JSON.stringify(SOURCES)]);
}

/**
 * @param {(text: string, params?: any[]) => Promise<any[]>} q  SQL as the schema owner
 * @param {{ school: string, ids: Record<"pillay" | "whitfield" | "bekker" | "naidoo" | "seven" | "six", string>, names: Record<string, string>, westville: string }} o
 * @returns {Promise<{ field: string, bat: string }>}
 */
export async function buildCaptainFixtures(q, { school, ids, names, westville }) {
  const squadOf = (keys) => keys.map((k) => ({ id: ids[k], name: names[k] }));
  const hil = squadOf(["whitfield", "bekker", "naidoo", "pillay", "seven", "six"]);
  const opp = OPP.map((n) => ({ id: n, name: n }));
  const mk = async (status, startsAt) => (await q(
    `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status)
     values ($1, '1XI', $2, '1XI', 'Westville Boys'' High 1XI', $3, 'cricket', 'T20', 20, $4) returning id`,
    [school, westville, startsAt, status]))[0].id;
  // Explicit instants: the fixtures are dated, not "now"; the live status is what makes them live.
  const field = await mk("live", "2026-10-02 09:00+02");
  const bat = await mk("live", "2026-10-02 10:00+02");
  for (const m of [field, bat]) {
    await fixConditions(q, m);
    await q(`insert into match_squad (match_id, player_id, side, batting_no) values
               ($1, $2, 'home', 1), ($1, $3, 'home', 2), ($1, $4, 'home', 3), ($1, $5, 'home', 4), ($1, $6, 'home', 5), ($1, $7, 'home', 6)`,
      [m, ids.whitfield, ids.bekker, ids.naidoo, ids.pillay, ids.seven, ids.six]);
  }

  // ── FIELD: Westville bat; Hilton bowl fourteen overs ──
  /** @type {any[]} */
  const log = [];
  let n = 0;
  const add = (innings, ev) => log.push({ ...ev, innings, id: `cap-${innings}-${++n}`, clientTs: Date.parse("2026-10-02T07:00:00Z") + n * 20000 });
  add(0, inningsStart({ battingTeam: "Westville Boys' High 1XI", bowlingTeam: "1XI", squad: opp, bowlingSquad: hil, overs: 20, captureProfile: "full" }));
  add(0, batters({ striker: OPP[0], nonStriker: OPP[1] }));
  // Over by over: N W N B N W N B W B S B S B  (Naidoo 4, Whitfield 3, Bekker 5, Seven 2).
  const attack = ATTACK;
  const pattern = [1, 0, 2, 0, 1, 0];
  for (const [o, who] of attack.entries()) {
    add(0, bowler({ bowler: ids[who] }));
    for (const [k, v] of pattern.entries()) {
      // A few placed shots, so "where they have scored" has something to draw.
      add(0, ball({ type: BALL_TYPE.RUN, value: o % 3 === 0 && k === 2 ? 4 : v,
        ...(o % 3 === 0 && k === 2 ? { shot: "drive", ...placementFromTap({ angle: 270, radius: 0.9 }) } : {}) }));
    }
  }
  await writeEvents(q, field, log);

  // ── BAT: Hilton bat; the first ball bowls Whitfield, Naidoo comes in ──
  const blog = [];
  const badd = (ev) => blog.push({ ...ev, innings: 0, id: `cap-bat-${blog.length + 1}`, clientTs: Date.parse("2026-10-02T08:00:00Z") + blog.length * 20000 });
  badd(inningsStart({ battingTeam: "1XI", bowlingTeam: "Westville Boys' High 1XI", squad: hil, bowlingSquad: opp, overs: 20, captureProfile: "full" }));
  badd(batters({ striker: ids.whitfield, nonStriker: ids.bekker }));
  badd(bowler({ bowler: OPP[2] }));
  badd(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" }));
  badd(batters({ striker: ids.naidoo }));
  for (const v of [1, 0, 4, 0, 2]) badd(ball({ type: BALL_TYPE.RUN, value: v }));
  await writeEvents(q, bat, blog);
  return { field, bat };
}
