/**
 * The events a match opens with, from the pad's config (startMatch(cfg),
 * scorer/engine.jsx): both innings declared up front, so the second already
 * knows its squads when the chase begins, and the openers and the opening
 * bowler chosen at setup. Lifted out of the engine as it was, word for word,
 * so the events a match started by position write can be held against the
 * ones a match with typed names writes (apps/web/test/positions.test.mjs;
 * Q5, Kameel 13 Nov 2026). Pure: no React, no storage, no clock.
 *
 * The side names follow the keys, which setup already ordered by the toss
 * (setup.jsx: teamKey1 is whoever bats first). team1/team2 stay in the
 * order they were picked, so naming the batting side from team1 put the
 * first-picked side's name on the other side's innings whenever it fielded
 * first (SCRBRD-067). In setup a side's name IS its key.
 *
 * The capture profile chosen at setup is declared on BOTH innings, for the
 * same reason (SCRBRD-039); the innings break may change the second's.
 */
import { inningsStart, batters as battersEvent, bowler as bowlerEvent } from "@scrbrd/scoring";

/**
 * @param {any} cfg  the pad's config (lib/practice.js practiceCfg, lib/pilot.js pilotCfg, setup.jsx)
 * @param {{intTeams?: Record<string, {players: {name: string}[]}>, stamp?: (e: any) => any}} [o]
 *   `intTeams`: the demonstration's sides (scorer/teams.js), whose bowling lists stand in for the squads;
 *   `stamp`: what a sent match does to an opening event (an id from the start)
 * @returns {[any[], any[]]}  the two innings' opening events
 */
export function openingEvents(cfg, { intTeams = {}, stamp = (e) => e } = {}) {
  const sq1 = cfg.squad1 || [], sq2 = cfg.squad2 || [];
  const tk1 = cfg.teamKey1 || cfg.team1, tk2 = cfg.teamKey2 || cfg.team2;
  const bsq1 = intTeams[tk2]?.players.map((p) => p.name) || sq2;
  const bsq2 = intTeams[tk1]?.players.map((p) => p.name) || sq1;
  const captureProfile = cfg.captureProfile ?? undefined;
  const open1 = [stamp(inningsStart({ innings: 0, battingTeam: tk1, bowlingTeam: tk2,
    squad: sq1, bowlingSquad: bsq1, twelfthMan: cfg.twelfth1 || null, teamKey: tk1, bowlingTeamKey: tk2, overs: cfg.overs || 20, captureProfile }))];
  const open2 = [inningsStart({ innings: 1, battingTeam: tk2, bowlingTeam: tk1,
    squad: sq2, bowlingSquad: bsq2, twelfthMan: cfg.twelfth2 || null, teamKey: tk2, bowlingTeamKey: tk1, overs: cfg.overs || 20, captureProfile })];
  // Openers and opening bowler chosen in setup step 4.
  if (cfg.opener1 && cfg.opener2 && cfg.openBowler) {
    open1.push(stamp(battersEvent({ innings: 0, striker: cfg.opener1, nonStriker: cfg.opener2 })));
    open1.push(stamp(bowlerEvent({ innings: 0, bowler: cfg.openBowler })));
  }
  return [open1, open2];
}
