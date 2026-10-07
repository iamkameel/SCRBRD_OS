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
 * The twelfth man the coach named for one end, or null. He does not bat and
 * is not in the side above; the wicket sheet offers him as the substitute
 * fielder he is there to be (Law 24).
 * @param {any[] | null | undefined} rows  GET /api/read/match_squad rows
 * @param {"home" | "away"} end
 * @returns {{id: string, name: string} | null}
 */
export function twelfthOf(rows, end) {
  const r = (rows ?? []).find((x) => x && x.side === end && x.twelfth === true && x.withdrawn !== true);
  return r ? { id: r.player_id, name: r.full_name } : null;
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
 * @returns {{home: {squad: SquadMember[] | null, source: SideSource, team: boolean, twelfth?: {id: string, name: string} | null},
 *            away: {squad: SquadMember[] | null, source: SideSource, twelfth?: {id: string, name: string} | null}}}
 *   `twelfth` only on a named side: the twelfth man the coach named, or null
 */
export function sidesFor({ players, squad, teamCode = null }) {
  const byId = new Map((players ?? []).map((p) => [p.id, p]));
  const homeNamed = namedSide(squad, "home", byId);
  const awayNamed = namedSide(squad, "away", byId);
  const roster = rosterOf(players, teamCode);
  const home = homeNamed ? { squad: homeNamed, source: /** @type {SideSource} */ ("named"), team: true, twelfth: twelfthOf(squad, "home") }
    : roster ? { squad: roster.squad, source: /** @type {SideSource} */ (squad ? "roster" : "unread"), team: roster.team }
    : { squad: null, source: /** @type {SideSource} */ (null), team: false };
  const away = awayNamed ? { squad: awayNamed, source: /** @type {SideSource} */ ("named"), twelfth: twelfthOf(squad, "away") }
    : { squad: null, source: /** @type {SideSource} */ (null) };
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

/**
 * WHO MAY BE TYPED IN. A boy typed by name is not linked to his record, so
 * the age and registration checks the coach's side passed do not follow him:
 * on an end with a named side the scorer picks from that side, and the typed
 * name waits behind the deliberate way out below (OFF_SIDE_ASK) — never
 * offered straight away. Every other end keeps the typed name — an away
 * school not on SCRBRD, a fixture nobody named a side for, the roster when
 * the side could not be read, a practice match, the pad's own match.
 *
 * A substitute fielder is not this rule's: the Laws let him be someone
 * outside the eleven (Law 24), and the wicket sheet keeps his typed name.
 * @param {SideSource | undefined} source
 * @returns {boolean}
 */
export const mayType = (source) => source !== "named";

/**
 * Which end of the fixture ("home" or "away") one side of an innings is: the
 * batting side or the bowling side, by the innings' batting team key against
 * the fixture's home key. Null when either key is missing.
 * @param {"batting" | "bowling"} side
 * @param {{battingKey?: string | null, homeKey?: string | null}} keys
 * @returns {"home" | "away" | null}
 */
export function endOf(side, { battingKey, homeKey }) {
  if (battingKey == null || homeKey == null) return null;
  const homeBats = battingKey === homeKey;
  return (side === "batting") === homeBats ? "home" : "away";
}

/**
 * What the pad says where a typed name used to be, on a named side's end:
 * one plain line, the coach's screen named as the coach sees it.
 * @param {"bat" | "bowl"} what
 */
export const onlyNamedWords = (what) =>
  `Only the side the coach named can ${what}. Ask the coach to change the side in Pick the side.`;

/**
 * THE WAY OUT (Kameel, 2026-10-07: "block, with a deliberate way out"). A
 * late change or a concussion replacement can still be typed in on a named
 * side's end, but only on purpose: the sheet asks "Not in the named side?",
 * says why the door exists, and only then shows the typed field.
 */
export const OFF_SIDE_ASK = "Not in the named side?";
export const OFF_SIDE_WHY = "For a late change or a concussion replacement. The coach will need to fix this after the match.";
export const OFF_SIDE_MARK = "typed in — not on the named side";

/**
 * Who on a named side's end was typed in, not picked. Derived, never
 * stored: a boy picked from the named side carries his player id (it is in
 * the squad innings_start holds), and a boy typed in carries only his name,
 * which is no id in that squad. The log carries both, so a reload tells
 * them apart as well as the sheet that sent him in did.
 * @param {Array<{id?: string, name?: string} | string> | null | undefined} squad  the end's squad, from innings_start
 * @returns {(id: string | null | undefined) => boolean}  true for a player who is not in it
 */
export function offSide(squad) {
  const ids = new Set((squad ?? []).map((p) => (typeof p === "string" ? p : p?.id ?? p?.name)));
  return (id) => id != null && !ids.has(id);
}
