/**
 * A knockout competition's bracket, from what is stored (SCRBRD-060).
 *
 * Nothing here is invented. The rounds, the ties and their bracket positions
 * are the competition's published knockout plan (fixture_plan, db/67: the
 * planner's draw, "ko:r<round>:m<match>:…"); each tie's match is the one
 * publishing made for it (fixture_plan_item); its sides, date and result are
 * that match's (competition_results(), db/69, the same read the league table
 * is drawn from); and a side's flag is db/72's (progression_conflict).
 *
 * A side is KNOWN when the stored data names it: the match's own side, the
 * entrant the draw placed there, or the winner of the tie that feeds it once
 * that tie has one (by play, a super over, or the organiser's decision). Any
 * other side is not known, and says which tie it waits for — never a guess.
 * A tie's date is its match's; a tie with no match yet carries the plan's
 * slot as `plannedAt`, a plan and not a fixture. Neither, and there is none.
 *
 * Pure: the route (results-api.mjs) reads the rows under the reader's RLS and
 * hands them here, so the shape is tested without a database
 * (bracket.test.mjs).
 */

/**
 * @typedef {object} BracketSide
 * @property {boolean} known
 * @property {string | null} label        the side's name, when known
 * @property {{ round: number, match: number } | null} from  the tie whose winner this side is
 */

/**
 * @typedef {object} BracketTie
 * @property {string} key                 the draw's fixture id
 * @property {number} match               its position in the round, 1-based
 * @property {string | null} matchId      the fixture publishing made, if any
 * @property {string | null} startsAt     the fixture's start, if there is a fixture
 * @property {string | null} plannedAt    the plan's slot, while there is no fixture
 * @property {string | null} status       the fixture's status; null with no fixture
 * @property {BracketSide} home
 * @property {BracketSide} away
 * @property {{ text: string | null, outcome: string | null, how: string | null } | null} result
 * @property {"home" | "away" | null} through   who goes on, once somebody does
 * @property {{ side: string, note: string, awaitingWinner: boolean, played: boolean }[]} flags
 */

/** How a winner was settled, in one word: play, super_over, conceded, walkover or awarded. @param {any} r */
export function howDecided(r) {
  if (!r || !r.winnerSide) return null;
  if (r.decidedBy === "super_over") return "super_over";
  if (r.decidedBy === "decision") return r.decision?.kind ?? r.marginKind ?? "awarded";
  return r.decidedBy ?? "play";
}

/**
 * @param {object} input
 * @param {{ id: string, name: string, compType: string }} input.competition
 * @param {{ id: string, version: number, publishedAt: string | null,
 *           entrants: { id: string, name?: string | null }[],
 *           plan: { fixtures: any[], byes?: { round: number, entrant: string }[] } } | null} input.plan
 *        the latest published knockout plan, or null
 * @param {{ fixtureKey: string, matchId: string }[]} input.items
 * @param {Map<string, { startsAt: string | null, status: string | null, home: string | null, away: string | null, result: any }>} input.matches
 *        the competition's fixtures by id, each with resultOut()'s result (or null)
 * @param {{ matchId: string, side: string, note: string, awaitingWinner: boolean, played: boolean }[]} [input.flags]
 */
export function bracketOf({ competition, plan, items, matches, flags = [] }) {
  const base = { competitionId: competition.id, name: competition.name, compType: competition.compType };
  const fixtures = plan ? (plan.plan?.fixtures ?? []) : [];
  if (!plan || !fixtures.length) {
    return { ...base, drawn: false, planVersion: null, publishedAt: null, rounds: [], byes: [], champion: null,
             fixturesOutsideDraw: matches.size };
  }
  const names = new Map((plan.entrants ?? []).map((e) => [e.id, e.name ?? null]));
  const made = new Map(items.map((i) => [i.fixtureKey, i.matchId]));
  const byKey = new Map(fixtures.map((f) => [f.id, f]));
  const flagsOf = (/** @type {string} */ m) => flags.filter((x) => x.matchId === m)
    .map((x) => ({ side: x.side, note: x.note, awaitingWinner: x.awaitingWinner === true, played: x.played === true }));

  /** @type {Map<string, BracketTie>} */ const ties = new Map();
  /** The tie for a fixture, built once (a side may ask for its feeder's winner). @param {any} f @returns {BracketTie} */
  const tieOf = (f) => {
    const had = ties.get(f.id);
    if (had) return had;
    const matchId = made.get(f.id) ?? null;
    const m = matchId ? matches.get(matchId) ?? null : null;
    const r = m?.result ?? null;
    const through = r?.winnerSide === "home" || r?.winnerSide === "away" ? r.winnerSide : null;
    /** @param {"home" | "away"} which @returns {BracketSide} */
    const side = (which) => {
      const s = f[which] ?? {};
      const feeder = s.winnerOf ? byKey.get(s.winnerOf) ?? null : null;
      const from = feeder ? { round: feeder.round, match: feeder.match } : null;
      // The fixture's own side, as the match row names it.
      if (m && m[which]) return { known: true, label: m[which], from };
      if (s.entrant) {
        const label = names.get(s.entrant) ?? null;
        return { known: label != null, label, from: null };
      }
      if (feeder) {
        const up = tieOf(feeder);
        const w = up.through ? up[up.through] : null;
        if (w && w.known) return { known: true, label: w.label, from };
      }
      return { known: false, label: null, from };
    };
    /** @type {BracketTie} */
    const tie = {
      key: f.id, match: f.match, matchId,
      startsAt: m?.startsAt ?? null,
      plannedAt: m ? null : f.startsAt ?? null,
      status: m?.status ?? null,
      home: { known: false, label: null, from: null }, away: { known: false, label: null, from: null },
      result: r ? { text: r.text ?? null, outcome: r.outcome ?? null, how: howDecided(r) } : null,
      through,
      flags: matchId ? flagsOf(matchId) : [],
    };
    ties.set(f.id, tie);
    tie.home = side("home");
    tie.away = side("away");
    return tie;
  };

  const roundNos = [...new Set(fixtures.map((f) => Number(f.round)))].sort((a, b) => a - b);
  const rounds = roundNos.map((round) => ({
    round,
    ties: fixtures.filter((f) => Number(f.round) === round).sort((a, b) => a.match - b.match).map(tieOf),
  }));
  const last = rounds[rounds.length - 1];
  const final = last && last.ties.length === 1 ? last.ties[0] : null;
  const champion = final && final.through && final[final.through].known ? final[final.through].label : null;
  const inDraw = new Set(made.values());
  return {
    ...base, drawn: true, planVersion: plan.version, publishedAt: plan.publishedAt ?? null,
    rounds,
    byes: (plan.plan.byes ?? []).map((b) => ({ round: b.round, label: names.get(b.entrant) ?? null })),
    champion,
    // The competition's fixtures the draw did not make (arranged by hand): listed
    // under Fixtures and Results, never placed in the bracket by a guess.
    fixturesOutsideDraw: [...matches.keys()].filter((id) => !inDraw.has(id)).length,
  };
}
