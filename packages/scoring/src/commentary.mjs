/**
 * SCRBRD — commentary, from the log (SCRBRD-098).
 *
 * One line per delivery, and a line for everything else a scorer records:
 * wickets, milestones, a bowler coming on, a batter coming in, the end of an
 * over, the end of an innings, a revision, penalty runs. Pure and
 * deterministic: the same events give the same lines on every device,
 * offline, free, and on a replay of a finished match. The pad's Commentary
 * card and the Match Centre's Commentary tab draw the same lines, so the
 * scorer and the ground read the same words.
 *
 * WHERE THE FACTS COME FROM
 * ─────────────────────────
 * The fold. Each innings is walked with foldSteps() (replay.mjs) — the fold
 * itself, handed out one event at a time — so a figure in a line is the
 * figure the scorecard shows at that point, and no rule of the game is
 * written a second time here. A void, and whatever it undoes, has no line,
 * because the fold drops both: an amendment reads as the corrected history.
 * Penalty runs awarded to a fielding side are credited across innings by the
 * match's own rule (penaltyCredits()), so "Westville start their innings on
 * 5" is the fold's figure, not this module's.
 *
 * WHERE THE NAMES COME FROM
 * ─────────────────────────
 * The caller, and nowhere else. Every player reference on an event — an id,
 * or a name the scorer typed for someone SCRBRD holds no row for, or the
 * fielder's name as the wicket sheet wrote it — goes through `nameOf(ref,
 * role)`, and what it returns is what the line says. The squads on
 * innings_start carry names, and the fold writes them into its batters and
 * bowlers; this module reads neither. So a signed-in screen passes the names
 * its reader may see, and a public page (PUBLIC_DATA L2/L4) passes
 * publicName()'s answer or a role word — "the batter", "the bowler". With no
 * `nameOf` at all, every person is a role word.
 *
 * Health and discipline (PUBLIC_DATA §3) are words too: "retires hurt" and a
 * bowler taken off injured or suspended are said only when the caller passes
 * `sensitive: true`. Otherwise a retirement reads "retires, not out" and a
 * change of bowler mid-over gives no reason.
 *
 * THE WORDS
 * ─────────
 * Plain, warm, factual, in the cricket English of a South African ground. A
 * line may vary its wording, but the choice is seeded by the event's own key,
 * so the same event always reads the same way. Nothing is said that the log
 * does not record: no line on the length of a ball, the crowd or a batter's
 * intent. A shot and where it went are named only when the scorer recorded
 * them (words.mjs); an id the vocabulary does not know says nothing rather
 * than itself. No line uses a pronoun for a player.
 */

import { KIND, BALL_TYPE, ILLEGAL, NB_RUNS, RUN_OUT_END, DISMISSAL, INNINGS_END_REASON, PENALTY_REASON,
  penaltyReasonWords, BOWLER_CHANGE_REASON, normaliseDismissal, normalisePenaltyReason, runsOffBat, chargedToBowler } from "./events.mjs";
import { deriveMatch, foldSteps, penaltyCredits, retirementDismissal, isMaiden, fmtOvers } from "./replay.mjs";
import { positionName, sectorOf, batHandOf } from "./placement.mjs";
import { SHOT_WORDS, NO_STROKE, SECTOR_WORDS } from "./words.mjs";

/** @import { LogEvent } from "./events.mjs" */
/** @import { Innings, BallLogEntry } from "./replay.mjs" */

/**
 * What each line is. A screen styles by it (a four, a wicket) and groups by
 * `innings` and `over`; the words are in `text`.
 */
export const COMMENTARY_KIND = Object.freeze({
  INNINGS_START: "innings_start",
  NEW_BATTER: "new_batter",
  BOWLER: "bowler",                 // a bowler on for the first time, or back for a new spell
  BOWLER_CHANGE: "bowler_change",   // a bowler taking over during an over (Law 17.8)
  BALL: "ball",
  FOUR: "four",
  SIX: "six",
  WICKET: "wicket",
  MILESTONE: "milestone",
  OVER_END: "over_end",
  PENALTY: "penalty",
  PENALTY_CREDIT: "penalty_credit", // an innings opening on runs awarded while its side was fielding
  SHORT_RUNNING: "short_running",
  RETIRE: "retire",
  REVISION: "revision",
  INNINGS_END: "innings_end",
});

/**
 * Who a reference is, in the line: the part the person is playing at that
 * moment. A role word is what the line says when the caller names nobody.
 * @typedef {"striker" | "non_striker" | "batter" | "bowler" | "fielder" | "keeper"} CommentaryRole
 */
/** @type {Readonly<Record<CommentaryRole, string>>} */
export const ROLE_WORDS = Object.freeze({
  striker: "the striker", non_striker: "the non-striker", batter: "the batter",
  bowler: "the bowler", fielder: "a fielder", keeper: "the keeper",
});

/**
 * One line.
 * @typedef {object} CommentaryItem
 * @property {number} innings  the innings number, as on the events (0 is the first)
 * @property {number} over     0-based: the over this line belongs to
 * @property {number} ball     the ball of that over, as the scorer writes it (the 3 of
 *   "5.3"): a wide or a no-ball takes the number of the ball still to come;
 *   0 before the over's first ball, 6 at its end
 * @property {string} kind     one of COMMENTARY_KIND
 * @property {string} text
 * @property {string} key      stable across re-renders: from the event's id where it
 *   has one, and its place in the log where it has not
 */

/**
 * @typedef {object} CommentaryOptions
 * @property {(ref: string, role: CommentaryRole) => string | null | undefined} [nameOf]
 *   a player reference (an id, or a name the scorer typed) → what the line
 *   calls him. The only source of a person's name. Nullish or empty → the
 *   role word.
 * @property {(key: string | null | undefined, name: string | null | undefined) => string | null | undefined} [teamName]
 *   a side's key and name as innings_start carries them → what the line calls
 *   the side. Defaults to the name.
 * @property {boolean} [sensitive]  say "retires hurt", and why a bowler was taken off
 *   (injured, suspended). Signed-in readers only; never a public page.
 */

// ── Words ────────────────────────────────────────────────

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
/** @param {number} n */
const words = (n) => (Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n));
/** @param {string} s */
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** @param {number} n  @param {string} one  @param {string} [many] */
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
/** @param {number} n */
const ordinal = (n) => ["first", "second", "third", "fourth", "fifth"][n - 1] ?? `${n}th`;
/** Overs as a line says them: "20", or "17.3" part-way through one.  @param {number} balls */
const oversText = (balls) => (balls % 6 === 0 ? String(balls / 6) : fmtOvers(balls));

/**
 * FNV-1a over the key: the seed for a line's choice of words. Not random —
 * the same key picks the same words on every device, every time.
 * @param {string} key
 */
function seedOf(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/**
 * @template T
 * @param {string} key  @param {string} slot  which choice in the line, so two choices in one line vary apart
 * @param {readonly T[]} options
 * @returns {T}
 */
const choose = (key, slot, options) => options[seedOf(`${key}|${slot}`) % options.length];

/**
 * Where the ball went, in words, when the scorer recorded it: a point by its
 * fielding position (positionName), a sector-era ball by its sector. Null
 * when neither was recorded.
 *
 * A stored seg is the SCREEN's sector, mirrored for a left-hander, so it is
 * read through the hand of the batter who faced the ball (sectorOf): his
 * cover drive is "through cover", not "through mid-wicket". A point's theta
 * is batter-relative already.
 * @param {{theta?: number | null, radius?: number | null, placementSource?: string | null, seg?: number | null}} b
 * @param {string} [batHand]  "R" | "L", the striker's
 * @returns {string | null}
 */
function areaOf(b, batHand = "R") {
  if (b.placementSource === "point" && b.theta != null && b.radius != null) {
    const p = positionName(b.theta, b.radius);
    if (p == null || p === "at feet") return null;
    if (p === "keeper") return "the keeper";
    const slip = /^slip (\d)$/.exec(p);
    if (slip) return `${ordinal(Number(slip[1]))} slip`;
    return p;
  }
  const s = sectorOf(b, batHand);
  return s == null ? null : SECTOR_WORDS[s];
}

/**
 * "to cover", "through cover", "over long-on" — or "straight down the ground".
 * @param {string} area  @param {"to" | "through" | "over"} prep
 */
function toArea(area, prep) {
  if (area === "straight") return "straight down the ground";
  if (prep === "through" && /deep|long|fine|third|slip|keeper|gully|short/.test(area)) return `to ${area}`;
  return `${prep} ${area}`;
}

/**
 * The shot and where it went, as recorded: "driven through cover", "pulled",
 * "to mid-wicket". Empty when the scorer recorded neither. A no-stroke shot
 * (beaten, padded away) is not sent anywhere.
 * @param {{shot?: string | null, theta?: number | null, radius?: number | null, placementSource?: string | null, seg?: number | null}} b
 * @param {"to" | "through" | "over"} prep
 * @param {string} [batHand]  the striker's, for a sector-era ball (areaOf)
 */
function shotPhrase(b, prep = "to", batHand = "R") {
  const shot = b.shot != null && Object.hasOwn(SHOT_WORDS, b.shot) ? SHOT_WORDS[b.shot] : null;
  const area = shot != null && NO_STROKE.has(/** @type {string} */ (b.shot)) ? null : areaOf(b, batHand);
  return [shot, area ? toArea(area, prep) : null].filter(Boolean).join(" ");
}

// ── The walk ─────────────────────────────────────────────

/**
 * What a line needs of the fold at one point. Read off the live innings
 * straight after each event, because the next step changes it.
 * @typedef {object} Snap
 * @property {number} runs  @property {number} wickets  @property {number} balls
 * @property {boolean} freeHit
 * @property {string | null} striker  @property {string | null} nonStriker
 * @property {string | null | undefined} bowler
 * @property {number | null} target  @property {number} overs
 * @property {Map<string, {runs: number, balls: number, status: string}>} bat
 * @property {Map<string, {runs: number, balls: number, wickets: number}>} bowl
 * @property {{runs: number, balls: number, bat1: string | null, bat2: string | null}} cp
 * @property {number} changes  bowler changes during an over, so far
 */

/** @param {Innings} inn  @returns {Snap} */
function snap(inn) {
  return {
    runs: inn.runs, wickets: inn.wickets, balls: inn.balls, freeHit: inn.freeHit,
    striker: inn.striker, nonStriker: inn.nonStriker, bowler: inn.bowler,
    target: inn.target, overs: inn.overs,
    bat: new Map(inn.batsmen.map((b) => [b.id, { runs: b.runs, balls: b.balls, status: b.status }])),
    bowl: new Map(inn.bowlers.map((b) => [b.id, { runs: b.runs, balls: b.balls, wickets: b.wickets }])),
    cp: { ...inn.curPartner },
    changes: inn.bowlerChanges.length,
  };
}

/** @param {number} carried  @returns {Snap} */
const openingSnap = (carried) => ({
  runs: carried, wickets: 0, balls: 0, freeHit: false, striker: null, nonStriker: null, bowler: null,
  target: null, overs: 20, bat: new Map(), bowl: new Map(), cp: { runs: 0, balls: 0, bat1: null, bat2: null }, changes: 0,
});

/**
 * The log, one list per innings, in innings order. Takes either shape a
 * caller holds: a match's flat log (each event's `innings` says which), or
 * the pad's list of logs by innings.
 * @param {LogEvent[] | LogEvent[][]} events
 * @returns {Map<number, LogEvent[]>}
 */
function byInningsOf(events) {
  /** @type {Map<number, LogEvent[]>} */
  const out = new Map();
  if (events.some((e) => Array.isArray(e))) {
    /** @type {LogEvent[][]} */ (events).forEach((evs, i) => { if (evs?.length) out.set(i, evs); });
  } else {
    for (const ev of /** @type {LogEvent[]} */ (events)) {
      const i = ev.innings ?? 0;
      const list = out.get(i);
      if (list) list.push(ev); else out.set(i, [ev]);
    }
  }
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/**
 * The commentary of a match, in the order it happened.
 *
 * @param {LogEvent[] | LogEvent[][]} events  the match's log (flat, or by innings)
 * @param {CommentaryOptions} [options]
 * @returns {CommentaryItem[]}
 */
export function deriveCommentary(events = [], options = {}) {
  const { sensitive = false } = options;
  /** @param {string | null | undefined} ref  @param {CommentaryRole} role */
  const who = (ref, role) => {
    if (ref == null || ref === "") return ROLE_WORDS[role];
    const n = options.nameOf ? options.nameOf(ref, role) : null;
    return n != null && String(n).trim() !== "" ? String(n) : ROLE_WORDS[role];
  };
  /** @param {string | null | undefined} key  @param {string | null | undefined} name */
  const side = (key, name) => {
    const n = options.teamName ? options.teamName(key, name) : name;
    return n != null && String(n).trim() !== "" ? String(n) : (name ?? key ?? "the batting side");
  };

  const byInnings = byInningsOf(events);
  const numbers = [...byInnings.keys()];
  // The match's fold: every innings' figures with the penalty runs to a
  // fielding side credited, and the result. Folded once more below, event by
  // event, for the lines; these are what the lines say at the end.
  const flat = [...byInnings].flatMap(([i, evs]) => evs.map((e) => ((e.innings ?? 0) === i ? e : { ...e, innings: i })));
  const match = deriveMatch(flat);
  /** @type {Map<number, Innings>} */
  const final = new Map(numbers.map((n, j) => [n, match.innings[j]]));
  const credits = penaltyCredits(final);

  /** @type {CommentaryItem[]} */
  const out = [];
  // How many lines each event has given so far: its first line takes the
  // event's key, the rest the key and a count.
  /** @type {Map<string, number>} */
  const keyCount = new Map();
  // Runs added to an innings that had ended, by awards made later, so far —
  // and runs a side's next innings will open on, so far. For "now 148" and
  // "will start their innings on 5" at the moment of each award.
  /** @type {Map<number, number>} */ const addedSoFar = new Map();
  /** @type {Map<string, number>} */ const carrySoFar = new Map();

  numbers.forEach((n, j) => {
    const evs = /** @type {LogEvent[]} */ (byInnings.get(n));
    const carried = credits.carried.get(n) ?? 0;
    const steps = foldSteps(evs, { carried });
    const counted = countedAfter(evs);

    let prev = openingSnap(carried);
    let started = false;
    /** @type {BallLogEntry | null} */ let lastBall = null;
    /** @type {{over: number, wicketsAtStart: number} | null} */ let overDue = null;
    let wicketsAtOverStart = 0;
    /** @type {Map<string, number>} */ const maidens = new Map();
    /** @type {Map<number, string>} */ const overBowler = new Map();
    // Each bowler's legal deliveries, in order: was it a wicket that is his?
    // For the hat-trick: three in three, as the pad's own overlay counts it.
    /** @type {Map<string, boolean[]>} */ const bowlerRun = new Map();
    /** @type {{at: number, balls: number} | null} */ let lastAnnounce = null;
    let batTeam = "";

    /**
     * @param {string} baseKey  @param {number} over  @param {number} ball
     * @param {string} kind  @param {string} text
     */
    const push = (baseKey, over, ball, kind, text) => {
      const k = keyCount.get(baseKey) ?? 0;
      keyCount.set(baseKey, k + 1);
      out.push({ innings: n, over, ball, kind, text: cap(text), key: k ? `${baseKey}#${k}` : baseKey });
    };
    /** Where a line with no delivery of its own goes: after the last ball. */
    const afterLast = () => (lastBall ? { over: lastBall.over, ball: lastBall.ballInOver + 1 } : { over: 0, ball: 0 });
    /** @param {Snap} s */
    const score = (s) => `${batTeam} ${s.runs}/${s.wickets}.`;

    /** @param {Snap} s  @param {Innings} inn */
    const flushOver = (s, inn) => {
      if (!overDue) return;
      const { over } = overDue;
      const balls = inn.overLog.find((o) => o.over === over)?.balls ?? [];
      const runs = balls.reduce((t, b) => t + (ILLEGAL.has(b.type ?? BALL_TYPE.RUN) ? 1 : 0) + (b.value ?? 0), 0);
      const wkts = s.wickets - overDue.wicketsAtStart;
      const maiden = isMaiden(balls);
      const bowlerId = overBowler.get(over) ?? null;
      if (maiden && bowlerId != null) maidens.set(bowlerId, (maidens.get(bowlerId) ?? 0) + 1);
      const key = `i${n}:o${over}`;
      const what = maiden && wkts === 0 ? "a maiden"
        : `${runs} ${plural(runs, "run")}${wkts ? `, ${words(wkts)} ${plural(wkts, "wicket")}` : ""}${maiden ? " (a wicket maiden)" : ""}`;
      const parts = [`End of over ${over + 1}: ${what}.`, score(s)];
      const atCrease = [s.striker, s.nonStriker].filter((id) => id != null)
        .map((id) => { const b = s.bat.get(/** @type {string} */ (id)); return `${who(id, "batter")} ${b?.runs ?? 0} (${b?.balls ?? 0})`; });
      if (atCrease.length) parts.push(cap(`${atCrease.join(", ")}.`));
      if (bowlerId != null) {
        const f = s.bowl.get(bowlerId);
        if (f) parts.push(`${cap(who(bowlerId, "bowler"))} ${oversText(f.balls)}-${maidens.get(bowlerId) ?? 0}-${f.runs}-${f.wickets}.`);
      }
      if (s.target != null) {
        const need = s.target - s.runs, left = s.overs * 6 - s.balls;
        if (need > 0 && left > 0) parts.push(`Need ${need} off ${left}.`);
      }
      push(key, over, 6, COMMENTARY_KIND.OVER_END, parts.join(" "));
      overDue = null;
      wicketsAtOverStart = s.wickets;
    };

    /** @type {IteratorResult<{ev: LogEvent, index: number, inn: Innings}, Innings>} */
    let step = steps.next();
    /** @type {Innings | null} */ let liveInn = null;
    while (!step.done) {
      const { ev, index, inn } = step.value;
      liveInn = inn;
      const cur = snap(inn);
      const key = ev.id != null ? `e:${ev.id}` : `i${n}:n${index}`;
      batTeam = side(inn.teamKey, inn.battingTeam);
      const fieldTeam = side(inn.bowlingTeamKey, inn.bowlingTeam);
      // An over's summary waits for the next thing that happens, so a penalty
      // awarded straight after its last ball is told inside it. It gives the
      // figures as they stood before that next thing.
      if (ev.kind !== KIND.PENALTY) flushOver(prev, inn);

      switch (ev.kind) {
        case KIND.INNINGS_START: {
          if (started) break;
          started = true;
          const text = cur.target != null
            ? `${batTeam} need ${cur.target} to win from ${cur.overs} overs.`
            : `${batTeam} to bat: ${cur.overs} overs.`;
          push(key, 0, 0, COMMENTARY_KIND.INNINGS_START, text);
          if (carried > 0) {
            push(key, 0, 0, COMMENTARY_KIND.PENALTY_CREDIT,
              `${batTeam} start their innings on ${carried}, from penalty runs awarded while they were fielding.`);
          }
          break;
        }

        case KIND.BATTERS: {
          const before = [prev.striker, prev.nonStriker];
          const fresh = [cur.striker, cur.nonStriker].filter((id) => id != null && !before.includes(id));
          const at = { over: Math.floor(cur.balls / 6), ball: cur.balls % 6 };
          if (fresh.length === 2 && prev.bat.size === 0) {
            push(key, at.over, at.ball, COMMENTARY_KIND.NEW_BATTER,
              `${who(cur.striker, "striker")} and ${who(cur.nonStriker, "non_striker")} open the batting for ${batTeam}.`);
            break;
          }
          for (const id of fresh) {
            const had = prev.bat.get(/** @type {string} */ (id));
            // Named only by the role, a new batter is simply that.
            const text = had?.status === "retired"
              ? `${who(id, "batter")} resumes, on ${had.runs} (${had.balls}).`
              : who(id, "batter") === ROLE_WORDS.batter ? "A new batter comes in."
              : choose(key, `in:${fresh.indexOf(id)}`, [
                `${who(id, "batter")} comes in.`,
                `${who(id, "batter")} is the new batter.`,
                `${who(id, "batter")} walks out to bat.`,
              ]);
            push(key, at.over, at.ball, COMMENTARY_KIND.NEW_BATTER, text);
          }
          break;
        }

        case KIND.BOWLER: {
          if (ev.bowler == null) break;
          // Taking over during an over (SCRBRD-080): the fold records it.
          if (cur.changes > prev.changes) {
            const c = inn.bowlerChanges[inn.bowlerChanges.length - 1];
            const why = !sensitive || c.reason == null ? ""
              : c.reason === BOWLER_CHANGE_REASON.SUSPENDED ? ", suspended by the umpires"
                : c.reason === BOWLER_CHANGE_REASON.INJURY ? ", who is injured" : "";
            const pos = afterLast();
            push(key, pos.over, pos.ball, COMMENTARY_KIND.BOWLER_CHANGE,
              `${who(c.to, "bowler")} will finish the over, taking over from ${who(c.from, "bowler")}${why}.`);
            break;
          }
          const over = Math.floor(cur.balls / 6);
          // Named again before a ball was bowled: the scorer changed their
          // mind, so the earlier announcement goes and this one stands.
          if (lastAnnounce && lastAnnounce.balls === cur.balls) {
            out.splice(lastAnnounce.at, 1);
            lastAnnounce = null;
          }
          // Said when a bowler comes on: for the first time in the innings, or
          // for a new spell. A bowler carrying on from his end is not news.
          const bowled = [...overBowler.values()].includes(ev.bowler);
          const recent = overBowler.get(over - 1) === ev.bowler || overBowler.get(over - 2) === ev.bowler;
          const B = who(ev.bowler, "bowler");
          let text = null;
          if (!bowled && over === 0) text = choose(key, "open", [`${B} opens the bowling.`, `${B} to open the bowling.`]);
          else if (!bowled && over === 1 && overBowler.size === 1) text = `${B} to bowl from the other end.`;
          else if (!bowled) text = choose(key, "new", [`${B} comes into the attack.`, `${B} into the attack.`, `New bowler: ${B}.`]);
          else if (!recent) text = choose(key, "back", [`${B} is back into the attack.`, `${B} returns to the attack.`]);
          if (text) {
            lastAnnounce = { at: out.length, balls: cur.balls };
            push(key, over, 0, COMMENTARY_KIND.BOWLER, text);
          }
          break;
        }

        case KIND.BALL: {
          const entry = inn.ballLog[inn.ballLog.length - 1];
          lastBall = entry;
          lastAnnounce = null;
          const bowlerId = entry.bowlerId ?? ev.bowler ?? null;
          const strikerId = entry.strikerId ?? ev.striker ?? null;
          if (bowlerId != null && !overBowler.has(entry.over)) overBowler.set(entry.over, bowlerId);
          const next = counted(index);
          const shortRun = next != null && next.kind === KIND.PENALTY && next.toBattingTeam === false
            && normalisePenaltyReason(next.reason, false) === PENALTY_REASON.SHORT_RUNNING;
          const { kind, text } = deliveryLine(ev, entry, {
            key, B: who(bowlerId, "bowler"), S: who(strikerId, "striker"), who, prev, cur, shortRun, score: score(cur),
            hand: batHandOf(inn, strikerId),
          });
          push(key, entry.over, entry.ballInOver + 1, kind, text);

          // Milestones this delivery brought up.
          const pos = { over: entry.over, ball: entry.ballInOver + 1 };
          if (strikerId != null) {
            const a = prev.bat.get(strikerId)?.runs ?? 0, b = cur.bat.get(strikerId);
            if (b) {
              for (const mark of [50, 100, 150, 200, 250, 300]) {
                if (a < mark && b.runs >= mark) {
                  const S = who(strikerId, "batter");
                  const text2 = mark === 50
                    ? choose(key, "fifty", [`Fifty for ${S}, from ${b.balls} balls.`, `${S} reaches fifty, from ${b.balls} balls.`])
                    : mark === 100
                      ? choose(key, "hundred", [`A hundred for ${S}, from ${b.balls} balls.`, `${S} reaches a hundred, from ${b.balls} balls.`])
                      : `${S} reaches ${mark}, from ${b.balls} balls.`;
                  push(key, pos.over, pos.ball, COMMENTARY_KIND.MILESTONE, text2);
                }
              }
            }
          }
          const samePair = cur.wickets === prev.wickets && cur.cp.bat1 === prev.cp.bat1 && cur.cp.bat2 === prev.cp.bat2
            && cur.cp.bat1 != null && cur.cp.bat2 != null;
          if (samePair) {
            for (const mark of [50, 100, 150, 200]) {
              if (prev.cp.runs < mark && cur.cp.runs >= mark) {
                const what = mark === 50 ? "Fifty" : mark === 100 ? "Hundred" : String(mark);
                push(key, pos.over, pos.ball, COMMENTARY_KIND.MILESTONE,
                  `${what} partnership for ${who(cur.cp.bat1, "batter")} and ${who(cur.cp.bat2, "batter")}, from ${cur.cp.balls} balls.`);
              }
            }
          }
          if (bowlerId != null) {
            const a = prev.bowl.get(bowlerId)?.wickets ?? 0, b = cur.bowl.get(bowlerId);
            if (b && b.wickets > a && b.wickets >= 5) {
              push(key, pos.over, pos.ball, COMMENTARY_KIND.MILESTONE,
                `${cap(words(b.wickets))} wickets for ${who(bowlerId, "bowler")}: ${b.wickets}/${b.runs}.`);
            }
            if (!ILLEGAL.has(ev.type ?? BALL_TYPE.RUN)) {
              const mine = ev.type === BALL_TYPE.WICKET && !entry.freeHitSaved && chargedToBowler(normaliseDismissal(ev.dismissal));
              const run = bowlerRun.get(bowlerId) ?? [];
              run.push(mine);
              bowlerRun.set(bowlerId, run);
              const [x, y, z] = run.slice(-3);
              if (mine && run.length >= 3 && x && y && z && !run[run.length - 4]) {
                push(key, pos.over, pos.ball, COMMENTARY_KIND.MILESTONE, `A hat-trick for ${who(bowlerId, "bowler")}.`);
              } else if (mine && run.length >= 2 && run[run.length - 2] && !(run.length >= 3 && run[run.length - 3])) {
                push(key, pos.over, pos.ball, COMMENTARY_KIND.MILESTONE, `${who(bowlerId, "bowler")} is on a hat-trick.`);
              }
            }
          }
          // The over is done: its summary goes out with whatever happens next.
          if (!ILLEGAL.has(ev.type ?? BALL_TYPE.RUN) && cur.balls % 6 === 0) {
            overDue = { over: entry.over, wicketsAtStart: wicketsAtOverStart };
          }
          break;
        }

        case KIND.PENALTY: {
          const runs = ev.runs ?? 5;
          const toBat = ev.toBattingTeam !== false;
          const reason = normalisePenaltyReason(ev.reason, toBat);
          // No Law clause numbers in anything a spectator reads (Kameel, 2026-09-26: he is
          // checking them against the current Code). The words stand without the bracket.
          const why = reason ? `, for ${penaltyReasonWords(reason)}` : "";
          const pos = afterLast();
          const head = `${cap(words(runs))} penalty ${plural(runs, "run")}`;
          if (toBat) {
            push(key, pos.over, pos.ball, COMMENTARY_KIND.PENALTY, `${head} to ${batTeam}${why}. ${score(cur)}`);
            break;
          }
          const parts = [`${head} to ${fieldTeam}${why}${reason === PENALTY_REASON.SHORT_RUNNING ? "; the runs are disallowed" : ""}.`];
          const sideKey = inn.bowlingTeamKey;
          if (sideKey != null) {
            const earlier = numbers.filter((k) => k < n && final.get(k)?.teamKey === sideKey).pop();
            if (earlier != null) {
              const base = /** @type {Innings} */ (final.get(earlier)).runs - (credits.added.get(earlier) ?? 0);
              const now = (addedSoFar.get(earlier) ?? 0) + runs;
              addedSoFar.set(earlier, now);
              parts.push(`They go on ${fieldTeam}'s total, now ${base + now}.`);
            } else {
              const now = (carrySoFar.get(sideKey) ?? 0) + runs;
              carrySoFar.set(sideKey, now);
              parts.push(`${fieldTeam} will start their innings on ${now}.`);
            }
          }
          if (cur.target != null && prev.target != null && cur.target !== prev.target) parts.push(`The target is now ${cur.target}.`);
          push(key, pos.over, pos.ball,
            reason === PENALTY_REASON.SHORT_RUNNING ? COMMENTARY_KIND.SHORT_RUNNING : COMMENTARY_KIND.PENALTY, parts.join(" "));
          break;
        }

        case KIND.RETIRE: {
          const pos = afterLast();
          const id = ev.batter ?? null;
          const b = id != null ? cur.bat.get(id) : undefined;
          const X = who(id, "batter");
          const how = retirementDismissal(ev);
          if (how === DISMISSAL.TIMED_OUT) {
            push(key, pos.over, pos.ball, COMMENTARY_KIND.WICKET, `${X} is timed out. ${score(cur)}`);
          } else if (how === DISMISSAL.RETIRED_OUT) {
            push(key, pos.over, pos.ball, COMMENTARY_KIND.WICKET, `${X} retires out, on ${b?.runs ?? 0} (${b?.balls ?? 0}). ${score(cur)}`);
          } else {
            const hurt = sensitive && (ev.reason ?? "hurt") === "hurt";
            push(key, pos.over, pos.ball, COMMENTARY_KIND.RETIRE,
              `${X} ${hurt ? "retires hurt" : "retires, not out"}, on ${b?.runs ?? 0} (${b?.balls ?? 0}).`);
          }
          break;
        }

        case KIND.REVISION: {
          const pos = afterLast();
          const r = ev.reason == null ? null : REVISION_REASON_WORDS[String(ev.reason).toLowerCase()] ?? null;
          const said = ev.overs != null && ev.target != null ? `the innings is now ${ev.overs} overs, and the target ${ev.target}`
            : ev.overs != null ? `the innings is now ${ev.overs} overs`
              : ev.target != null ? `the target is now ${ev.target}` : "";
          if (said) push(key, pos.over, pos.ball, COMMENTARY_KIND.REVISION, `Revision${r ? ` ${r}` : ""}: ${said}.`);
          break;
        }

        default: break; // innings_end is told once the innings is done, below
      }
      prev = cur;
      step = steps.next();
    }

    const done = step.value;   // the settled innings, with its carried runs
    if (liveInn) flushOver(snap(done), done);
    if (!done.complete || !started) return;
    const pos = afterLast();
    const T = side(done.teamKey, done.battingTeam);
    const r = done.runs, w = done.wickets;
    const parts = [];
    switch (done.endReason) {
      case INNINGS_END_REASON.ALL_OUT:
        parts.push(`${T} are all out for ${r}${done.balls < done.overs * 6 ? `, in ${oversText(done.balls)} overs` : ""}.`); break;
      case INNINGS_END_REASON.OVERS:
        parts.push(`End of the innings: ${T} ${r}/${w} from ${oversText(done.balls)} overs.`); break;
      case INNINGS_END_REASON.TARGET: {
        const left = Math.max(0, done.overs * 6 - done.balls);
        parts.push(`${T} reach the target of ${done.target}, with ${left} ${plural(left, "ball")} to spare.`); break;
      }
      case INNINGS_END_REASON.DECLARED: parts.push(`${T} declare on ${r}/${w}.`); break;
      case INNINGS_END_REASON.ABANDONED: parts.push(`The innings is abandoned at ${r}/${w}, after ${oversText(done.balls)} overs.`); break;
      default: parts.push(`End of the innings: ${T} ${r}/${w}.`);
    }
    if (j === 0 && numbers.length === 1) {
      parts.push(`${side(done.bowlingTeamKey, done.bowlingTeam)} need ${r + 1} to win.`);
    }
    if (j === 1 && match.result) {
      const res = match.result;
      if (res.winner == null) parts.push("The match is tied.");
      else {
        const inns = [...final.values()].find((x) => x.battingTeam === res.winner);
        parts.push(`${side(inns?.teamKey, res.winner)} win by ${res.margin}.`);
      }
    }
    push(`i${n}:end`, pos.over, pos.ball, COMMENTARY_KIND.INNINGS_END, parts.join(" "));
  });
  return out;
}

/** @type {Readonly<Record<string, string>>}  the revision sheet's reasons (sheets.jsx RevisionSheet) */
const REVISION_REASON_WORDS = Object.freeze({
  rain: "for rain", "bad light": "for bad light", bad_light: "for bad light",
  "late start": "after a late start", late_start: "after a late start",
  "ground unfit": "with the ground unfit", ground_unfit: "with the ground unfit",
});

/**
 * The next event that counts after `index` — the fold's filter (a void and
 * whatever it undoes do not) — or null.
 * @param {LogEvent[]} evs
 * @returns {(index: number) => LogEvent | null}
 */
function countedAfter(evs) {
  /** @type {Set<string>} */
  const voided = new Set();
  for (const e of evs) if (e.kind === KIND.VOID && e.target != null) voided.add(e.target);
  return (index) => {
    for (let i = index + 1; i < evs.length; i++) {
      const e = evs[i];
      if (e.kind === KIND.VOID || (e.id != null && voided.has(e.id))) continue;
      return e;
    }
    return null;
  };
}

/**
 * @typedef {object} LineContext
 * @property {string} key  @property {string} B  @property {string} S
 * @property {(ref: string | null | undefined, role: CommentaryRole) => string} who
 * @property {Snap} prev  @property {Snap} cur
 * @property {boolean} shortRun  the next event disallows this ball's runs (Law 18.5)
 * @property {string} score  "Hilton 43/3." after the ball
 * @property {"R" | "L"} hand  the striker's (batHandOf): which way a sector-era ball's seg reads
 */

/**
 * The line for one delivery, and its kind.
 * @param {import("./events.mjs").Loose<import("./events.mjs").BallEvent>} ev  a ball
 * @param {BallLogEntry} entry  the fold's log entry for it
 * @param {LineContext} c
 * @returns {{kind: string, text: string}}
 */
function deliveryLine(ev, entry, c) {
  const { key, B, S, who, prev, cur, score, hand } = c;
  const type = ev.type ?? BALL_TYPE.RUN;
  const v = ev.value ?? 0;
  const lead = `${prev.freeHit ? "Free hit: " : ""}${B} to ${S}`;
  const free = type === BALL_TYPE.NO_BALL ? " Free hit to come." : "";
  const sa = shotPhrase(entry, "to", hand);
  /** @param {string} body */
  const line = (body) => `${lead}, ${body}`;
  /** @param {string[]} parts */
  const join = (...parts) => parts.filter(Boolean).join(", ");

  if (c.shortRun) {
    return { kind: COMMENTARY_KIND.BALL,
      text: `${line(join(sa, "they run, but the umpire calls deliberate short running and no runs count"))}.${free}` };
  }

  switch (type) {
    case BALL_TYPE.WIDE: {
      const body = v === 0 ? choose(key, "wd", ["wide", "a wide", "that's a wide"])
        : `wide, and ${words(v)} more: ${v + 1} wides`;
      return { kind: COMMENTARY_KIND.BALL, text: `${line(body)}.` };
    }
    case BALL_TYPE.NO_BALL: {
      if (ev.nbRuns === NB_RUNS.BYES || ev.nbRuns === NB_RUNS.LEG_BYES) {
        const what = ev.nbRuns === NB_RUNS.BYES ? plural(v, "bye") : plural(v, "leg bye");
        return { kind: COMMENTARY_KIND.BALL, text: `${line(`no-ball, and ${words(v)} ${what} off it`)}.${free}` };
      }
      const off = runsOffBat(ev);
      const body = off === 0 ? "no-ball"
        : (off === 4 || off === 6) && sa ? `no-ball, ${shotPhrase(entry, off === 6 ? "over" : "through", hand)} for ${words(off)}`
          : off === 4 || off === 6 ? `no-ball, and ${words(off)} off the bat`
            : `no-ball, ${sa ? `${sa}, ` : ""}and they run ${words(off)}`;
      return { kind: off === 6 ? COMMENTARY_KIND.SIX : off === 4 ? COMMENTARY_KIND.FOUR : COMMENTARY_KIND.BALL, text: `${line(body)}.${free}` };
    }
    case BALL_TYPE.BYE:
    case BALL_TYPE.LEG_BYE: {
      const one = type === BALL_TYPE.BYE ? "bye" : "leg bye";
      const shot = ev.shot != null && Object.hasOwn(SHOT_WORDS, ev.shot) ? SHOT_WORDS[ev.shot] : "";
      const body = v === 0 ? "no run" : `${words(v)} ${plural(v, one)}`;
      return { kind: COMMENTARY_KIND.BALL, text: `${line(join(shot, body))}.` };
    }
    case BALL_TYPE.WICKET: {
      const mode = normaliseDismissal(ev.dismissal);
      const outId = ev.dismissed ?? entry.strikerId ?? null;
      const F = ev.fielder ? who(ev.fielder, mode === DISMISSAL.STUMPED ? "keeper" : "fielder") : null;
      const area = areaOf(entry, hand);
      /** @type {string} */
      let method;
      switch (mode) {
        case DISMISSAL.BOWLED: method = ev.shot === "missed" ? "beaten and bowled" : "bowled"; break;
        case DISMISSAL.LBW: method = "lbw"; break;
        case DISMISSAL.CAUGHT: {
          const shot = ev.shot != null && Object.hasOwn(SHOT_WORDS, ev.shot) && !NO_STROKE.has(ev.shot) ? SHOT_WORDS[ev.shot] : null;
          const where = area == null ? "" : area === "the keeper" ? (F ? "" : " by the keeper") : ` at ${area}`;
          // The catcher named as the bowler is named: caught and bowled. A
          // role word never matches ("a fielder", "the bowler"), so a public
          // line does not claim it.
          method = F != null && F === B ? `${shot ? `${shot} and ` : ""}caught and bowled`
            : `${shot ? `${shot} and ` : ""}caught${F ? ` by ${F}` : ""}${where}`;
          break;
        }
        case DISMISSAL.STUMPED: method = `stumped${F ? ` by ${F}` : ""}`; break;
        case DISMISSAL.HIT_WICKET: method = "hit wicket"; break;
        case DISMISSAL.HANDLED_BALL: method = "handled the ball"; break;
        case DISMISSAL.OBSTRUCTING_FIELD: method = "obstructing the field"; break;
        case DISMISSAL.HIT_TWICE: method = "hit the ball twice"; break;
        case DISMISSAL.RUN_OUT: {
          const D = who(outId, outId === entry.strikerId ? "striker" : "non_striker");
          const end = ev.outAt === RUN_OUT_END.BOWLER ? " at the bowler's end" : ev.outAt === RUN_OUT_END.STRIKER ? " at the striker's end" : "";
          method = `${v ? `they complete ${words(v)}, and ` : ""}${D} is run out${end}${F ? ` (${F})` : ""}`;
          break;
        }
        default: method = "out";
      }
      if (entry.freeHitSaved) {
        return { kind: COMMENTARY_KIND.BALL, text: `${line(`${method}, but it's a free hit: not out`)}.` };
      }
      const D = who(outId, "batter");
      const f = outId != null ? cur.bat.get(outId) : undefined;
      const r = f?.runs ?? 0, b = f?.balls ?? 0;
      const gone = r === 0
        ? `${cap(D)} is out for a duck, from ${b} ${plural(b, "ball")}.`
        : choose(key, "gone", [`${cap(D)} goes for ${r} from ${b} ${plural(b, "ball")}.`, `${cap(D)} is out for ${r}, from ${b} ${plural(b, "ball")}.`]);
      const leadWord = choose(key, "out", ["out", "and that's out"]);
      const body = mode === DISMISSAL.RUN_OUT ? `${leadWord}: ${method}` : `${leadWord}, ${method}`;
      return { kind: COMMENTARY_KIND.WICKET, text: `${line(body)}. ${gone} ${score}` };
    }
    default: {
      if (v === 4 || v === 6) {
        const p = shotPhrase(entry, v === 6 ? "over" : "through", hand);
        const word = v === 6 ? choose(key, "six", ["six", "six runs", "that's six"]) : choose(key, "four", ["four", "four runs", "that's four"]);
        return { kind: v === 6 ? COMMENTARY_KIND.SIX : COMMENTARY_KIND.FOUR, text: `${line(join(word, p))}.` };
      }
      const runs = v === 0 ? choose(key, "dot", ["no run", "dot ball"])
        : v === 1 ? choose(key, "one", ["one run", "a single", "they take one"])
          : v === 2 ? choose(key, "two", ["two runs", "they come back for two"])
            : v === 3 ? choose(key, "three", ["three runs", "they run three"])
              : `${words(v)} runs`;
      return { kind: COMMENTARY_KIND.BALL, text: `${line(join(sa, runs))}.` };
    }
  }
}
