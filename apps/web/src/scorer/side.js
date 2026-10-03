/**
 * THE SIDE THE PAD SCORES, for a real fixture.
 *
 * A coach names the side (Pick the side: POST /api/matches/:id/squad), and
 * that is where the safeguarding checks live — the age and registration
 * triggers on `match_squad`. The pad used to read the team's roster instead,
 * so the coach's sheet and the scorer could disagree, and a boy the triggers
 * refused could still be put in to bat. Now each end of the fixture takes the
 * side its coach named when there is one: the rows not withdrawn (the
 * `match_squad` read already leaves those out), in batting order, the
 * unnumbered after them. The twelfth man is not in it: he does not bat, and
 * the pad's fielder lists are the bowling squad.
 *
 * An end with no named side keeps what it had: the home end the team's roster
 * (and every player the scorer can read when the team has none listed, as
 * before), the away end nobody — its players are typed as they come in, which
 * is also what a school not on SCRBRD always gets.
 *
 * Pure, so it is proved under plain node (apps/web/test/scorer-side.test.mjs):
 * no DOM, no network.
 */

/**
 * @typedef {{id: string, name: string, batHand: "L" | "R"}} SquadMember
 * @typedef {"named" | "roster" | "unread" | null} SideSource
 *   named: the side the coach named. roster: the team's roster, no side named.
 *   unread: the team's roster, because the named side could not be read.
 *   null: nothing from the server; names are typed as they come in.
 */

/** batHand travels with the squad: placement is stored batter-relative, so without it every left-hander's innings is mirrored. */
const handOf = (/** @type {any} */ p) => (/^l/i.test(p?.batting_style || "") ? "L" : "R");

/**
 * The side named for one end, in batting order, from the `match_squad` read's
 * raw rows: not withdrawn, not the twelfth man, numbered first (1 to 11), then
 * any the coach left without a number. Null when that end has no named side.
 * @param {any[] | null | undefined} rows  GET /api/read/match_squad rows
 * @param {"home" | "away"} end
 * @param {Map<string, any>} [players]  the players read by id, for the batting hand
 * @returns {SquadMember[] | null}
 */
export function namedSide(rows, end, players = new Map()) {
  const mine = (rows ?? []).filter((r) => r && r.side === end && r.withdrawn !== true && r.twelfth !== true);
  if (!mine.length) return null;
  return [...mine]
    .sort((a, b) => (a.batting_no ?? 99) - (b.batting_no ?? 99) || String(a.full_name).localeCompare(String(b.full_name)))
    .map((r) => ({ id: r.player_id, name: r.full_name, batHand: handOf(players.get(r.player_id)) }));
}

/**
 * The roster as the pad has always read it: the team's players, else every
 * player the scorer may read. Null when there is no players read at all.
 * @param {any[] | null | undefined} players  GET /api/read/players rows
 * @param {string | null | undefined} teamCode
 * @returns {{squad: SquadMember[], team: boolean} | null}  `team` says whether the team filter found anyone
 */
export function rosterOf(players, teamCode) {
  if (!Array.isArray(players)) return null;
  const team = players.filter((p) => !teamCode || p.team_code === teamCode);
  return { squad: (team.length ? team : players).map((p) => ({ id: p.id, name: p.full_name, batHand: handOf(p) })), team: team.length > 0 };
}

/**
 * Both ends' squads, and where each came from.
 * @param {{players: any[] | null, squad: any[] | null, teamCode?: string | null}} reads
 *   `players` the players read (null: it failed); `squad` the match_squad read (null: it failed)
 * @returns {{home: {squad: SquadMember[] | null, source: SideSource, team: boolean},
 *            away: {squad: SquadMember[] | null, source: SideSource}}}
 */
export function sidesFor({ players, squad, teamCode = null }) {
  const byId = new Map((players ?? []).map((p) => [p.id, p]));
  const homeNamed = namedSide(squad, "home", byId);
  const awayNamed = namedSide(squad, "away", byId);
  const roster = rosterOf(players, teamCode);
  const home = homeNamed ? { squad: homeNamed, source: /** @type {SideSource} */ ("named"), team: true }
    : roster ? { squad: roster.squad, source: /** @type {SideSource} */ (squad ? "roster" : "unread"), team: roster.team }
    : { squad: null, source: /** @type {SideSource} */ (null), team: false };
  const away = awayNamed ? { squad: awayNamed, source: /** @type {SideSource} */ ("named") } : { squad: null, source: /** @type {SideSource} */ (null) };
  return { home, away };
}

/**
 * The pad's one line about a squad's source, or null when there is nothing
 * to say (names typed as they come in).
 * @param {SideSource} source
 * @param {string | null | undefined} teamCode  the home team's code, for the roster's words
 * @param {boolean} [team]  whether the roster is the team's (false: every player the scorer may read)
 * @returns {string | null}
 */
export function sideWords(source, teamCode, team = true) {
  const whole = team && teamCode ? `The whole ${teamCode} roster` : "Every player at the school";
  if (source === "named") return "The side the coach named";
  if (source === "roster") return `${whole}: no side has been named`;
  if (source === "unread") return `${whole}: the side the coach named could not be read`;
  return null;
}
