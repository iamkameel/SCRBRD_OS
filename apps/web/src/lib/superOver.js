/**
 * The super over on a screen (SCRBRD-114 phase 3b, the Sonnet items;
 * docs/design/SCRBRD-114_phase3_results_super_over.md §3.5, §3.6, §4, §11).
 *
 * Pure, and the one place a screen asks "may a super over start, and if not,
 * why". It asks the engine and invents no rule of its own:
 *
 *   - the match's playing conditions, as the write path asks them
 *     (superOverRefusal(), services/api/write/events-api.mjs): the frozen
 *     document says `result.tie_break` = `super_over` and `format.kind` =
 *     `limited`;
 *   - the fold: the last pair of innings is level (pairState()) and its
 *     second innings is sealed;
 *   - the Laws: lawsRefusal() on the innings_start that would open it, the
 *     refusals of §3.3 (`super_over_not_tied`, `super_over_number` …) in the
 *     engine's own words (REFUSAL_TEXT).
 *
 * Nothing here reads a role, a competition's name or a format string. The
 * pad, the board, the scorecard and the commentary all read an innings'
 * `superOver` marker (the fold's `inn.superOver`) and nothing else to tell a
 * super over from a match innings.
 *
 * NOT IN THE ENGINE, so here: which batters and bowlers of an EARLIER super
 * over may not play a later one (§3.2: standard, words on the pad and never a
 * refusal — D4). The fold carries who was out and who bowled in every
 * innings, so `eligibilityNotes()` reads them off it. The umpires decide;
 * the scorer records what happened.
 */
import { PAIR_STATE, REFUSAL_TEXT, lawsRefusal, inningsStart, pairState } from "@scrbrd/scoring";

/** One over a side, and the loss of two wickets ends the innings (§3.2). */
export const SUPER_OVER_OVERS = 1;
export const SUPER_OVER_WICKETS = 2;

/** Is this folded innings a super over's? */
export const isSuperOver = (inn) => inn != null && inn.superOver != null;

/** Where the first super-over innings is, or the count when there is none. @param {any[]} innings */
export function firstSuperOverAt(innings = []) {
  const k = innings.findIndex((x) => isSuperOver(x));
  return k < 0 ? innings.length : k;
}

/** The match's own innings: the ones before any super over. @param {any[]} innings */
export const matchInningsOf = (innings = []) => innings.slice(0, firstSuperOverAt(innings));

/**
 * The super overs of a match, in order: its number, where its innings are in
 * the match's list, the innings, and how the pair stands (`won`, `tied`,
 * `incomplete`) by the engine's own rule.
 * @param {any[]} innings
 * @returns {{n: number, at: number[], innings: any[], state: string, winner: any}[]}
 */
export function superOversOf(innings = []) {
  /** @type {Map<number, {n: number, at: number[], innings: any[]}>} */
  const by = new Map();
  innings.forEach((inn, i) => {
    if (!isSuperOver(inn)) return;
    const e = by.get(inn.superOver) ?? { n: inn.superOver, at: [], innings: [] };
    e.at.push(i); e.innings.push(inn);
    by.set(inn.superOver, e);
  });
  return [...by.values()].sort((a, b) => a.n - b.n).map((e) => {
    const ps = pairState(e.innings[0], e.innings[1]);
    return { ...e, state: ps.state, winner: ps.winner };
  });
}

/** "Super over 1", "Super over 2" … @param {number} n */
export const superOverTitle = (n) => `Super over ${n}`;

/**
 * Which innings of its pair this is: "first" or "second". Null for a match
 * innings. @param {any[]} innings @param {number} i
 */
export function pairPlace(innings, i) {
  const inn = innings[i];
  if (!isSuperOver(inn)) return null;
  return innings[i - 1]?.superOver === inn.superOver ? "second" : "first";
}

/**
 * The chase innings `i` is: its target and the innings it chases, or null for
 * a first innings. The match's second innings and a super over's second.
 * @param {any[]} innings @param {number} i
 * @returns {{target: number, of: number} | null}
 */
export function chaseOf(innings, i) {
  const inn = innings[i];
  if (!inn) return null;
  if (isSuperOver(inn)) {
    return pairPlace(innings, i) === "second" ? { target: inn.target ?? (innings[i - 1].runs + 1), of: i - 1 } : null;
  }
  return i === 1 ? { target: inn.target ?? ((innings[0]?.runs ?? 0) + 1), of: 0 } : null;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** The engine's words for a refusal, as a sentence. @param {string} code */
const engineWords = (code) => upperFirst(String(REFUSAL_TEXT[code] ?? code)).replace(/\.?$/, ".");

/**
 * The board's block while a super over is on (§4): the target, the balls left
 * and the wickets left of two, in words. Null for a match innings.
 * @param {any} inn  a folded innings
 * @param {{target?: number | null}} [o]  the chase's target when the caller has one
 * @returns {{title: string, wicketsLeft: string, ballsLeft: string, target: string | null, line: string} | null}
 */
export function superOverBlock(inn, { target = null } = {}) {
  if (!isSuperOver(inn)) return null;
  const overs = inn.overs ?? SUPER_OVER_OVERS;
  const left = Math.max(0, overs * 6 - inn.balls);
  const wl = Math.max(0, SUPER_OVER_WICKETS - inn.wickets);
  const aim = inn.target ?? target;
  const need = aim == null ? null : aim - inn.runs;
  const ballsLeft = plural(left, "ball left", "balls left");
  const wicketsLeft = `${wl === 0 ? "no wickets" : plural(wl, "wicket", "wickets")} left of ${SUPER_OVER_WICKETS}`;
  const targetWords = aim == null ? null : need <= 0 ? "Target reached" : `Need ${need} off ${left}`;
  const title = superOverTitle(inn.superOver);
  return { title, wicketsLeft, ballsLeft, target: targetWords,
           line: [title, targetWords ?? ballsLeft, wicketsLeft].join(" · ") };
}

/** What a side is, from one of its innings: batting or bowling. @param {any} inn @param {boolean} batting */
const sideOf = (inn, batting) => batting
  ? { team: inn.battingTeam, key: inn.teamKey ?? inn.battingTeam, squad: inn.squad ?? [], twelfthMan: inn.twelfthMan ?? null }
  : { team: inn.bowlingTeam, key: inn.bowlingTeamKey ?? inn.bowlingTeam, squad: inn.bowlingSquad ?? [], twelfthMan: null };

/**
 * May a super over start now, and if not, why — the pad's answer (§3.5).
 *
 *   state "none"       nothing to say: play is on, or the match was not level
 *   state "available"  the button: `n`, `at` (where the innings opens),
 *                      `standard` and `other` (the two sides, in the standard
 *                      order), `words`
 *   state "refused"    the match is level and a super over is not to be: `words`,
 *                      the engine's, and `refusal` the code
 *
 * "Level" is the last pair's: the match's own two innings, or the last super
 * over's. A pair left incomplete (the light went, §3.6) offers nothing and
 * says nothing here: the result line says it, and the organiser decides.
 *
 * @param {{innings: any[], events?: any[][], conditions?: Record<string, unknown> | null}} o
 */
export function superOverOffer({ innings, events = [], conditions = null }) {
  const none = { state: "none", n: null, at: null, standard: null, other: null, words: null, refusal: null };
  let lastAt = innings.length - 1;
  while (lastAt >= 0 && !innings[lastAt]) lastAt--;
  const last = innings[lastAt];
  if (!last || !last.sealed) return none;
  const place = pairPlace(innings, lastAt);
  const firstAt = isSuperOver(last) ? (place === "second" ? lastAt - 1 : -1) : (lastAt === 1 ? 0 : -1);
  if (firstAt < 0) return none;
  const first = innings[firstAt];
  if (pairState(first, last).state !== PAIR_STATE.TIED) return none;

  const c = conditions ?? {};
  const n = (superOversOf(innings).at(-1)?.n ?? 0) + 1;
  const at = lastAt + 1;
  if (!(c["result.tie_break"] === "super_over" && c["format.kind"] === "limited")) {
    return { ...none, state: "refused", refusal: "super_over_not_provided",
             words: `Match tied. ${engineWords("super_over_not_provided")}` };
  }
  const probe = { ...inningsStart({ battingTeam: last.battingTeam, bowlingTeam: last.bowlingTeam, overs: SUPER_OVER_OVERS, superOver: n }), innings: at };
  const why = lawsRefusal({ innings, events }, probe);
  if (why) return { ...none, state: "refused", refusal: why, words: `Match tied. ${engineWords(why)}` };

  // The standard order: the side that batted second bats first (§3.2).
  const standard = sideOf(last, true), other = sideOf(first, true);
  return { state: "available", n, at, refusal: null, standard, other,
           words: `Match tied. This match's playing conditions provide a super over: ${standard.team} bat first.` };
}

/**
 * The first innings of the pair, as the pad sends it (§3.5): the marker, one
 * over, both squads from the match, the side chosen to bat first.
 * @param {ReturnType<typeof superOverOffer>} offer  an "available" offer
 * @param {{swap?: boolean, captureProfile?: string}} [o]
 */
export function superOverFirstStart(offer, { swap = false, captureProfile } = {}) {
  const bat = swap ? offer.other : offer.standard;
  const bowl = swap ? offer.standard : offer.other;
  return inningsStart({
    battingTeam: bat.team, bowlingTeam: bowl.team, teamKey: bat.key, bowlingTeamKey: bowl.key,
    squad: bat.squad, bowlingSquad: bowl.squad, twelfthMan: bat.twelfthMan,
    overs: SUPER_OVER_OVERS, superOver: offer.n,
    ...(captureProfile ? { captureProfile } : {}),
  });
}

/**
 * The second innings of the pair, opened when the first is sealed (§3.5): the
 * other side, the same marker, and the target one more than the first.
 * @param {any} first  the pair's first innings, folded
 * @param {{captureProfile?: string}} [o]
 */
export function superOverChaseStart(first, { captureProfile } = {}) {
  return inningsStart({
    battingTeam: first.bowlingTeam, bowlingTeam: first.battingTeam,
    teamKey: first.bowlingTeamKey, bowlingTeamKey: first.teamKey,
    squad: first.bowlingSquad ?? [], bowlingSquad: first.squad ?? [],
    overs: SUPER_OVER_OVERS, superOver: first.superOver, target: first.runs + 1,
    ...(captureProfile ? { captureProfile } : {}),
  });
}

/**
 * Who may not play a later super over, in words (§3.2, D4): the batters out
 * in an earlier one, and the bowlers of an earlier one. Words and never a
 * refusal — the umpires decide. Read off the fold; innings from `at` on are
 * not looked at.
 * @param {any[]} innings @param {number} at  the innings about to be played
 * @param {{battingKey: string | null, bowlingKey: string | null}} sides
 * @returns {{batters: Map<string, string>, bowlers: Map<string, string>}}
 */
export function eligibilityNotes(innings, at, { battingKey, bowlingKey }) {
  const batters = new Map(), bowlers = new Map();
  for (let i = 0; i < at && i < innings.length; i++) {
    const inn = innings[i];
    if (!isSuperOver(inn)) continue;
    if ((inn.teamKey ?? inn.battingTeam) === battingKey) {
      for (const b of inn.batsmen ?? []) if (b.status === "out" && !batters.has(b.id)) batters.set(b.id, `Out in super over ${inn.superOver}: may not bat in this one`);
    }
    if ((inn.bowlingTeamKey ?? inn.bowlingTeam) === bowlingKey) {
      for (const b of inn.bowlers ?? []) if (b.balls > 0 && !bowlers.has(b.id)) bowlers.set(b.id, `Bowled super over ${inn.superOver}: may not bowl in this one`);
    }
  }
  return { batters, bowlers };
}

/** Said once, when a super over opens (§3.2, last row): what the pad does not record. */
export const NOT_RECORDED_WORDS =
  "The pad records the balls, the wickets and the players. It does not record the ends, the interval, fielding restrictions or nominated batters.";

/** Said on the sheet: the umpires decide, the pad records what happened (D4). */
export const UMPIRES_DECIDE_WORDS = "The umpires decide who may play. The pad records what happened.";

/**
 * The commentary's words for a super over's innings (§4): its own opening
 * lines, "End of the super over" for the over's end, and no career-milestone
 * lines. Lines of a match innings are returned as they came.
 *
 * deriveCommentary() is the engine's and is not changed; this reads its
 * items and the fold.
 * @param {{innings: number, over: number, ball: number, kind: string, text: string, key: string}[]} items
 * @param {any[]} innings  the fold's innings, by number
 * @param {{teamName?: (key: string | null, name: string | null) => string | null | undefined}} [o]
 */
export function superOverCommentary(items, innings, { teamName } = {}) {
  const said = (inn) => {
    const key = inn.teamKey ?? null;
    const n = teamName ? teamName(key, inn.battingTeam) : null;
    return n != null && String(n).trim() !== "" ? String(n) : inn.battingTeam;
  };
  const out = [];
  for (const item of items) {
    const inn = innings[item.innings];
    if (!isSuperOver(inn)) { out.push(item); continue; }
    if (item.kind === "milestone") continue;
    if (item.kind === "innings_start") {
      const text = pairPlace(innings, item.innings) === "second" && inn.target != null
        ? `Super over ${inn.superOver}. ${said(inn)} need ${inn.target} to win from one over; two wickets end it.`
        : `Super over ${inn.superOver}. ${said(inn)} to bat first: one over, and two wickets end it.`;
      out.push({ ...item, text });
      continue;
    }
    if (item.kind === "over_end") {
      out.push({ ...item, text: item.text.replace(/^End of over \d+:/, "End of the super over:") });
      continue;
    }
    out.push(item);
  }
  return out;
}

/**
 * Is a super over being played — begun, and neither decided nor abandoned?
 * The light going is the scorer's seal "abandoned" (§3.6), after which the
 * engine's own words ("the super over was not completed") are true.
 * @param {any[]} innings  @param {string | null | undefined} status  the match's status
 */
export function superOverInPlay(innings, status = null) {
  if (status === "complete") return false;
  const last = superOversOf(innings).at(-1);
  if (!last || last.state !== PAIR_STATE.INCOMPLETE) return false;
  return !last.innings.some((x) => x.endReason === "abandoned");
}

/**
 * The line a live screen says while a super over is on, in place of the
 * engine's "the super over was not completed" (true only once the light has
 * gone): null when no super over is being played.
 * @param {any[]} innings  @param {string | null | undefined} status
 * @returns {string | null}
 */
export function liveSuperOverLine(innings, status = null) {
  if (!superOverInPlay(innings, status)) return null;
  return `Match tied; ${superOverTitle(/** @type {number} */ (superOversOf(innings).at(-1)?.n)).toLowerCase()} in progress`;
}
