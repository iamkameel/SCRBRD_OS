/**
 * The pad's penalty runs (Law 41; SCRBRD-094 item 1: the screen) — what the
 * sheet asks, and the fold the pad reads, with no React in it.
 *
 * THE FOLD. Five runs to the fielding side belong in THEIR total: their most
 * recently completed innings, or, if they have not batted yet, their next
 * one, which opens on them (docs/SCORING_RULES.md, "Penalty runs to the
 * fielding side cross innings"). deriveInnings() folds one innings and cannot
 * see an award made in another, so the pad folds its per-innings log with
 * deriveInningsList() — the whole match, credits applied — and a projection
 * ("what would this innings be with these events") is the same fold with the
 * events appended. With no award to a fielding side in the log the two are
 * the same innings, figure for figure (the scoring package proves that over
 * generated logs; the walks prove it on the pad).
 *
 * THE QUESTIONS. The sheet asks the Laws before it offers the Award button:
 * lawsRefusal() over the fold the pad already has, with the event it would
 * send. A refusal is said in words on the sheet and the button is disabled
 * with it; the event is never built into the log to be refused.
 *
 * NO LAW CLAUSE NUMBERS on the pad (Kameel, 2026-09-26: he is checking them
 * against the current Code). PENALTY_REASON_TEXT carries them in brackets;
 * the pad reads the same words without them, through the scoring package's
 * penaltyReasonWords() — the one helper the held sheet and the commentary use too.
 */
import {
  PENALTY_REASON, PENALTY_REASON_SIDE, REFUSAL, REFUSAL_TEXT,
  deriveInningsList, lawsRefusal, penalty, penaltyCredits, shortRunning, withoutLawClause, penaltyReasonWords,
} from "@scrbrd/scoring";

/** Each innings of the pad's log, credits across innings applied. */
export function foldPad(events, ctx) {
  return deriveInningsList(events, ctx);
}

/** The pad's log with `evs` appended to innings `curIn`. A copy. */
export function withAppended(events, curIn, evs) {
  const cp = [...events];
  cp[curIn] = [...(events[curIn] ?? []), ...evs];
  return cp;
}

/** Innings `curIn` as it would be with `evs` appended — the match's fold, not one innings'. */
export function projectPad(events, curIn, evs, ctx) {
  return foldPad(withAppended(events, curIn, evs), ctx)[curIn];
}

/** Words without a Law clause: "deliberate short running (Law 41.5)" → "deliberate short running".
 *  The scoring package's one rule for it (withoutLawClause), under the pad's old name. */
export const withoutLaw = withoutLawClause;

const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A reason in words, for a button: capitalised, no clause number (penaltyReasonWords). */
export function reasonWords(reason) {
  return upperFirst(penaltyReasonWords(reason));
}

/**
 * The reasons the sheet offers for an award to one side, in the order it
 * offers them: the side's own offences, then "other". Short running is not
 * among them: it is a delivery as well as an award, and has its own action
 * (shortRunning(): the ball and the five, together).
 * @param {boolean} toBattingTeam
 */
export function reasonsFor(toBattingTeam) {
  const all = Object.values(PENALTY_REASON);
  const own = all.filter((r) => PENALTY_REASON_SIDE[r] === toBattingTeam && r !== PENALTY_REASON.SHORT_RUNNING);
  const either = all.filter((r) => PENALTY_REASON_SIDE[r] == null);
  return [...own, ...either];
}

/** The award the sheet would send. */
export function awardEvent(curIn, { toBattingTeam, reason }) {
  return penalty({ innings: curIn, runs: 5, toBattingTeam, reason });
}

/**
 * Why the Laws would refuse this award, or null. Asked of the fold the pad
 * holds — `{innings, events}` as lawsRefusal() takes them — never by sending.
 */
export function awardRefusal(match, curIn, choice) {
  return lawsRefusal(match, awardEvent(curIn, choice));
}

/** The two events of a short run on this delivery (shortRunning()), for innings `curIn`. */
export function shortRunEvents(curIn, delivery) {
  return shortRunning({ ...delivery, innings: curIn });
}

/**
 * Why the Laws would refuse a short run now, or null: the delivery first,
 * against the match as it is; then the award, against the match with the
 * delivery in it — which is how the server judges the two when they arrive
 * one after the other.
 */
export function shortRunRefusal(match, curIn, delivery, ctx) {
  const [ball, award] = shortRunEvents(curIn, delivery);
  const first = lawsRefusal(match, ball);
  if (first) return first;
  const events = withAppended(match.events, curIn, [ball]);
  return lawsRefusal({ innings: foldPad(events, ctx), events }, award);
}

/** A refusal, said to the scorer on the sheet: present tense, plain words, no clause numbers. */
const SHEET_WORDS = Object.freeze({
  [REFUSAL.MATCH_DECIDED]: "The match is decided. Five runs to the fielding side now would move a target nobody is chasing.",
  [REFUSAL.PENALTY_REASON_SIDE]: "That offence is this side's own. The five runs go to the other side.",
  [REFUSAL.PENALTY_REASON_UNKNOWN]: "The scorebook does not know that reason.",
  [REFUSAL.PENALTY_RUNS_INVALID]: "Penalty runs are a whole number above nought.",
  [REFUSAL.SHORT_RUN_UNMATCHED]: "The five for short running go straight after the delivery, recorded with no runs.",
  [REFUSAL.NO_INNINGS]: "Nobody has said who is batting in this innings yet.",
  // A short run is a delivery first: the pad's own gate (readiness.mjs).
  [REFUSAL.INNINGS_CLOSED]: "This innings is closed.",
  [REFUSAL.INNINGS_OVER]: "This innings is over.",
  [REFUSAL.OPENERS]: "The opening batters have not been chosen.",
  [REFUSAL.NEXT_BATTER]: "There is no batter at one end.",
  [REFUSAL.OPENING_BOWLER]: "The opening bowler has not been chosen.",
  [REFUSAL.NEXT_BOWLER]: "Nobody has been named to bowl this over.",
  [REFUSAL.PREVIOUS_INNINGS_OPEN]: "The previous innings has not ended.",
  [REFUSAL.LATER_INNINGS_STARTED]: "A later innings has already started.",
});

/** @param {string | null | undefined} code  a lawsRefusal() answer */
export function refusalWords(code) {
  if (!code) return null;
  return SHEET_WORDS[code] ?? `${upperFirst(withoutLaw(REFUSAL_TEXT[code] ?? code))}.`;
}

/**
 * Awards to a fielding side whose next innings is not in the log yet
 * (penaltyCredits().pending), in words: "Michaelhouse start their innings on
 * 5". One line per side, its awards summed.
 * @param {(object | null | undefined)[]} innings  foldPad()'s answer
 * @returns {{team: string, name: string, runs: number, words: string}[]}
 */
export function pendingCredits(innings) {
  const list = (innings ?? []).map((inn, i) => [i, inn]).filter(([, inn]) => inn);
  const { pending } = penaltyCredits(list);
  /** @type {Map<string, {team: string, name: string, runs: number, words: string}>} */
  const byTeam = new Map();
  for (const p of pending) {
    const name = innings[p.from]?.bowlingTeam || p.team;
    const had = byTeam.get(p.team);
    const runs = (had?.runs ?? 0) + p.runs;
    byTeam.set(p.team, { team: p.team, name, runs, words: `${name} start their innings on ${runs}` });
  }
  return [...byTeam.values()];
}

/**
 * Where five runs to the chosen side go, in words, before they are awarded:
 * the batting side's total now; the fielding side's last innings (and so the
 * target, mid-chase); or the fielding side's next innings, which opens on them.
 */
export function whereTheRunsGo(innings, curIn, toBattingTeam) {
  const inn = innings?.[curIn];
  if (!inn) return null;
  if (toBattingTeam) return `Added to ${inn.battingTeam}'s total now.`;
  const side = inn.bowlingTeamKey;
  const batted = side != null && (innings ?? []).some((x, k) => k < curIn && x?.teamKey === side);
  if (!batted) return `${inn.bowlingTeam} start their innings on 5.`;
  return inn.target != null
    ? `Added to ${inn.bowlingTeam}'s total. The target rises by 5.`
    : `Added to ${inn.bowlingTeam}'s total.`;
}
