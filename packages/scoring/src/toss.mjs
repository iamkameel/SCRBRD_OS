/**
 * SCRBRD — the toss, and the first innings it decides. SCRBRD-067.
 *
 * `innings_start` is the one event undo will not walk past (undo.mjs,
 * FOUNDATION), so the side it names as batting cannot be put right on the
 * pad once it is written. On a live fixture that side comes from the toss —
 * the one the server records (match_toss) and answers `bats_first` for — and
 * never from which side happens to be listed first. With no toss to read the
 * scorer is asked; nothing here has a default.
 *
 * The rule itself is bats_first() in db/02_schema_scoring.sql. It is written
 * again here for one case only: the scorer answered the toss on the pad and
 * the server could not be told (no signal), so the pad has to open the
 * innings from the answer by itself. The tests hold the two to the same four
 * cases smoke-toss.mjs holds the SQL to.
 */

/** @typedef {"home"|"away"} Side */

/**
 * A toss as the pad knows it: read from the server (`toss_won_by`,
 * `toss_decision`) or answered by the scorer.
 * @typedef {object} Toss
 * @property {Side} wonBy
 * @property {"bat"|"bowl"} decision
 */

/**
 * Who bats first, from the toss alone — bats_first() in SQL. Null for
 * anything that is not a whole toss: an unknown is never guessed.
 * @param {{wonBy?: unknown, decision?: unknown}|null|undefined} toss
 * @returns {Side|null}
 */
export function battingFirst(toss) {
  const wonBy = toss?.wonBy, decision = toss?.decision;
  if (wonBy !== "home" && wonBy !== "away") return null;
  if (decision === "bat") return wonBy;
  if (decision === "bowl") return wonBy === "home" ? "away" : "home";
  return null;
}

/**
 * The toss in a fixture row from GET /api/read/matches, or null when the row
 * has none. The row carries the server's own answer (`bats_first`); a row
 * where that and the pair it came from disagree is not trusted either way —
 * the scorer is asked, as for no toss at all.
 * @param {any} row
 * @returns {(Toss & {batsFirst: Side})|null}
 */
export function tossFromRow(row) {
  const toss = { wonBy: row?.toss_won_by, decision: row?.toss_decision };
  const batsFirst = battingFirst(toss);
  if (batsFirst == null) return null;
  if (row.bats_first != null && row.bats_first !== batsFirst) return null;
  // battingFirst returned a side, so both fields are ones it accepts.
  return { .../** @type {Toss} */ (toss), batsFirst };
}

/**
 * The sides of a live fixture's first innings: who bats, who bowls, and whose
 * squad goes where.
 *
 * `team1` is the home side and `team2` the away side, as the Match Centre
 * opens the scorer (App.jsx openScorer). The pad reads one roster, the home
 * side's (`homeSquad`); the away side's players are named as they come in.
 * So when the away side bats first the home squad is the BOWLING squad, and
 * the batting squad is empty — the two swap with the batting side, never
 * stay where the fixture lists them.
 *
 * @param {object} args
 * @param {Side} args.batsFirst
 * @param {{team1?: string, team2?: string, teamKey1?: string, teamKey2?: string}} args.fixture
 * @param {any[]|null} [args.homeSquad]
 * @returns {{battingTeam: string|undefined, bowlingTeam: string|undefined,
 *            teamKey: string|undefined, bowlingTeamKey: string|undefined,
 *            squad: any[], bowlingSquad: any[]}}
 */
export function firstInningsSides({ batsFirst, fixture, homeSquad = null }) {
  if (batsFirst !== "home" && batsFirst !== "away") throw new Error("firstInningsSides: batsFirst must be 'home' or 'away'");
  const home = { team: fixture.team1, key: fixture.teamKey1 ?? fixture.team1, squad: homeSquad ?? [] };
  const away = { team: fixture.team2, key: fixture.teamKey2 ?? fixture.team2, squad: /** @type {any[]} */ ([]) };
  const [bat, bowl] = batsFirst === "home" ? [home, away] : [away, home];
  return {
    battingTeam: bat.team, bowlingTeam: bowl.team,
    teamKey: bat.key, bowlingTeamKey: bowl.key,
    squad: bat.squad, bowlingSquad: bowl.squad,
  };
}
