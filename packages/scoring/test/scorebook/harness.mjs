/**
 * THE REPLAY HARNESS — a scorebook's balls through the pad's event path, the
 * fold over them, and every figure held to the card the paper states.
 *
 * WHAT IT BUILDS, AND WHY THAT WAY. Each mark becomes the event the pad
 * records for it on Basic Scoring, built by the scoring package's own
 * constructors (ball, batters, bowler, retire, penalty, shortRunning,
 * inningsStart, revision, sealInnings) with exactly the arguments the pad's
 * code hands them: apps/web/src/scorer/delivery.js (deliveryOf, noBallEvent,
 * extraWicketEvent), retire.js, penalty.js (awardEvent) and engine.jsx's
 * confirmWicket, addBatsman, addBowler and the innings break. Where the pad
 * reads its own fold to decide something — who is on strike for the event's
 * crease fields, whether a free hit is due, which end a new batter walks to,
 * the chase's target — this reads the same fold, as the pad does; it never
 * reads a figure the card is compared with. apps/web/test/scorebook-pad.test.mjs
 * builds one scorebook through the pad's functions themselves and holds the
 * two logs equal, so this file and the pad cannot drift.
 *
 * Added with INV-11 to INV-15, from the same code: the no-ball's kind
 * (delivery.js noBallEvent: front foot, height, beamer), a delivery not in
 * the over (penalty.js notInOverEvents), a bowler suspended (suspension.js
 * suspendEvent, engine.jsx recordSuspension), the wicket-keeper (engine.jsx
 * addKeeper), a declaration match's format, and the milestones the facts
 * give (deriveFacts) held to a card that states them.
 *
 * Every event is also asked of the Laws (lawsRefusal) before it is added, as
 * the server asks it at commit: a paper the server would refuse is reported.
 *
 * Then the whole log is folded once with deriveMatch(), and compareCard()
 * holds each innings to its card, field by field.
 */
import {
  inningsStart, batters, bowler, ball, retire, penalty, revision, shortRunning, sealInnings, noPlacement,
  notInOverDelivery, bowlerSuspended, keeper, lawsEdition, deriveFacts,
  deriveInningsList, deriveMatch, lawsRefusal, fmtOvers,
  PLACEMENT_NULL, CAPTURE_PROFILE, RETIRE_REASON, INNINGS_END_REASON,
} from "../../src/index.mjs";
import { ballsOf } from "./format.mjs";

/** @import { Scorebook, PaperInnings, Step, Delivery, Card } from "./format.mjs" */
/** @import { LogEvent } from "../../src/events.mjs" */

/** The fixed clock every event of a proof is stamped with: the match's date, 08:00 UTC. @param {Scorebook} book */
export const clockOf = (book) => Date.parse(`${book.date}T08:00:00Z`);

/** A cup's playing conditions: a tie goes to a super over (result-logs.mjs CUP). */
const CUP = Object.freeze({ "format.kind": "limited", "format.innings_per_side": 1, "result.tie_break": "super_over" });
/** A league's: a tie stands. */
const LEAGUE = Object.freeze({ "format.kind": "limited", "format.innings_per_side": 1, "result.tie_break": "none" });

/** A declaration match's: one innings a side, no free hit (the format says so, as the fixture's `match.format` does). */
const DECLARATION = Object.freeze({ "format.kind": "declaration", "format.innings_per_side": 1, "result.tie_break": "none" });

/** The fold's context for a scorebook: its date, its conditions, its sides. @param {Scorebook} book */
export function contextOf(book) {
  const [home, away] = book.sides;
  return {
    startsAt: `${book.date}T08:00:00Z`,
    ...(book.conditions === "cup" ? { conditions: CUP } : book.conditions === "league" ? { conditions: LEAGUE }
      : book.conditions === "declaration" ? { conditions: DECLARATION, format: "One-Day Declaration" } : {}),
    sides: { home, away }, names: { home, away },
  };
}

/** A player's id: his side and his number. Never a name. @param {string} side @param {string} code */
export const idOf = (side, code) => `${side}:${code}`;

/** The batting side's eleven, in order. @param {string} side */
const battingSquad = (side) => Array.from({ length: 11 }, (_, k) => ({ id: idOf(side, `B${k + 1}`), name: `B${k + 1}` }));
/** The fielding side: its bowlers by number, and its fielders by number. @param {string} side */
const fieldingSquad = (side) => [
  ...Array.from({ length: 11 }, (_, k) => ({ id: idOf(side, `BW${k + 1}`), name: `BW${k + 1}` })),
  ...Array.from({ length: 11 }, (_, k) => ({ id: idOf(side, `F${k + 1}`), name: `F${k + 1}` })),
];

/**
 * The crease on the event, from the innings before the ball (delivery.js crease()).
 * @param {any} i
 */
const crease = (i) => ({ striker: i?.striker ?? null, nonStriker: i?.nonStriker ?? null, bowler: i?.bowler ?? null });

/**
 * A delivery as commitBall() hands it to ball(): delivery.js deliveryOf() on
 * Basic Scoring — no shot, no approach, no area ("not required").
 * @param {{type: string, value: number, freeHit: boolean, crease: object, notBoundary?: boolean}} d
 */
const deliveryOf = ({ type, value, freeHit, crease: c, notBoundary = false }) => ({
  type, value, shot: null, bowlerApproach: null, freeHit,
  ...c,
  ...noPlacement(PLACEMENT_NULL.NOT_REQUIRED, CAPTURE_PROFILE.QUICK),
  ...(type === "run" && notBoundary ? { boundary: false } : {}),
});

/**
 * The wicket a wide or a no-ball carries (delivery.js wicketFields()).
 * @param {{dismissal: string, fielder: string | null, fielders?: string[], dismissed?: string | null, outAt?: string | null} | null} w
 */
const wicketFields = (w) => (w ? {
  dismissal: w.dismissal, fielder: w.fielder || null,
  ...(w.fielders?.length ? { fielders: w.fielders } : {}),
  ...(w.dismissed ? { dismissed: w.dismissed } : {}),
  ...(w.outAt ? { outAt: w.outAt } : {}),
} : {});

/**
 * A no-ball, as the no-ball question records it (delivery.js noBallEvent()):
 * the pad's default kind, front foot; whose the runs were only when there are runs.
 * @param {any} inn @param {Delivery} d @param {any} wk
 */
const noBallOf = (inn, d, wk) => ball(/** @type {any} */ ({
  type: "Nb", value: d.value, shot: null, seg: null, zone: null, nbType: d.nbType ?? "front_foot",
  ...(d.value > 0 && d.nbRuns ? { nbRuns: d.nbRuns } : {}),
  ...(d.notBoundary ? { boundary: false } : {}),
  ...crease(inn), ...wicketFields(wk),
}));

/**
 * The paper's wicket in the wicket sheet's terms: the method, the fielder by
 * name and by reference, who was out when not the striker, the end.
 * @param {any} inn @param {string} fieldSide @param {NonNullable<Delivery["wicket"]>} w
 */
function sheetOf(inn, fieldSide, w) {
  const bowlerId = inn?.bowler ?? null;
  const fielderName = w.fielder === "bowler" ? String(bowlerId ?? "").split(":")[1] : w.fielder;
  const fielderId = w.fielder === "bowler" ? bowlerId : w.fielder ? idOf(fieldSide, w.fielder) : null;
  return {
    dismissal: w.how, fielder: fielderName ?? null,
    ...(fielderId ? { fielders: [fielderId] } : {}),
    dismissed: w.nonStriker ? inn?.nonStriker ?? null : null,
    outAt: w.end,
  };
}

/**
 * The events one delivery mark records, as the pad builds them.
 * @param {any} inn  the innings before the ball (the pad's fold)
 * @param {number} i  the innings number
 * @param {string} fieldSide
 * @param {Delivery} d
 * @returns {LogEvent[]}
 */
export function deliveryEvents(inn, i, fieldSide, d) {
  const freeHit = !!inn?.freeHit;
  const wk = d.wicket ? sheetOf(inn, fieldSide, d.wicket) : null;
  if (d.type === "Nb") return [noBallOf(inn, d, wk)];
  if (d.type === "Wd" && wk) return [ball(/** @type {any} */ ({ ...deliveryOf({ type: "Wd", value: d.value, freeHit, crease: crease(inn) }), ...wicketFields(wk) }))];
  if (d.type === "W" && wk) {
    // engine.jsx confirmWicket(), the delivery itself (not off an extra).
    return [ball(/** @type {any} */ ({
      type: "W", value: d.value, shot: null, seg: null, zone: null,
      dismissal: wk.dismissal, fielder: wk.fielder || null, freeHit,
      ...(wk.fielders ? { fielders: wk.fielders } : {}),
      ...crease(inn),
      ...(wk.dismissed ? { dismissed: wk.dismissed } : {}),
      ...(wk.outAt ? { outAt: wk.outAt } : {}),
      ...(d.nbRuns ? { nbRuns: d.nbRuns } : {}),
    }))];
  }
  const delivery = deliveryOf({ type: d.type, value: d.value, freeHit, crease: crease(inn), notBoundary: d.notBoundary });
  // delivery.js notInOverEvents(): the delivery marked, then the five to the batting side.
  if (d.notInOver) return [...notInOverDelivery(/** @type {any} */ ({ ...delivery, innings: i }), d.notInOver)];
  if (d.shortRun) return [...shortRunning(/** @type {any} */ ({ ...delivery, innings: i }))];
  return [ball(/** @type {any} */ (delivery))];
}

/**
 * @typedef {object} Built
 * @property {LogEvent[][]} byInnings  the log, innings by innings, as the pad holds it
 * @property {LogEvent[]} log          the same log, flat, in order
 * @property {string[]} problems       what the paper could not be scored as (a refusal, a batter short)
 */

/**
 * Score a scorebook, mark by mark, through the pad's event path.
 * @param {Scorebook} book
 * @returns {Built}
 */
export function buildLog(book) {
  const ctx = contextOf(book);
  const t0 = clockOf(book);
  /** @type {LogEvent[][]} */
  const byInnings = [];
  /** @type {LogEvent[]} */
  const log = [];
  /** @type {string[]} */
  const problems = [];
  const view = () => ({ innings: deriveInningsList(byInnings, ctx), events: byInnings });
  const innAt = (/** @type {number} */ i) => /** @type {any} */ (view().innings[i]);

  /** Ask the Laws, then add. @param {number} i @param {string} what @param {LogEvent[]} evs */
  const emit = (i, what, evs) => {
    while (byInnings.length <= i) byInnings.push([]);
    for (const e of evs) {
      const ev = /** @type {LogEvent} */ ({ ...e, innings: i, clientTs: t0 });
      const refused = lawsRefusal(view(), ev);
      if (refused) problems.push(`${book.match} innings ${i + 1}: the Laws refuse ${what} (${ev.kind}): ${refused}`);
      byInnings[i].push(ev);
      log.push(ev);
    }
  };

  book.innings.forEach((paper, i) => {
    const side = paper.side;
    const other = book.sides[0] === side ? book.sides[1] : book.sides[0];
    const prev = i > 0 ? innAt(i - 1) : null;
    // The chase's target as the break sets it (engine.jsx, the innings
    // break: the umpires' figure, else the first innings' runs and one) —
    // and a super over's second innings, the first's and one.
    const chases = paper.superOver == null ? i === 1 : book.innings[i - 1]?.superOver === paper.superOver;
    const target = paper.target ?? (chases && prev ? prev.runs + 1 : null);
    emit(i, "the innings' start", [inningsStart(/** @type {any} */ ({
      battingTeam: side, bowlingTeam: other, teamKey: side, bowlingTeamKey: other,
      squad: battingSquad(side), bowlingSquad: fieldingSquad(other), twelfthMan: null,
      overs: paper.overs ?? (paper.superOver != null ? 1 : book.overs), target,
      ...(paper.superOver != null ? { superOver: paper.superOver } : {}),
    }))]);
    if (!paper.openers) { problems.push(`${book.match} innings ${i + 1}: no openers`); return; }
    emit(i, "the openers", [batters({ striker: idOf(side, paper.openers[0]), nonStriker: idOf(side, paper.openers[1]) })]);
    /** @type {Set<string>} */
    const used = new Set(paper.openers);

    // A new batter walks in at the empty end: the next in the order who has
    // not batted (engine.jsx addBatsman: the striker's end when it is empty).
    const fill = () => {
      for (let guard = 0; guard < 2; guard++) {
        const inn = innAt(i);
        if (inn.complete || (inn.striker != null && inn.nonStriker != null)) return;
        const next = Array.from({ length: 11 }, (_, k) => `B${k + 1}`).find((b) => !used.has(b));
        if (!next) { problems.push(`${book.match} innings ${i + 1}: an end is empty and nobody is left to bat`); return; }
        used.add(next);
        emit(i, `${next} walking in`, [batters(inn.striker == null ? { striker: idOf(side, next) } : { nonStriker: idOf(side, next) })]);
      }
    };

    for (const line of paper.lines) {
      if (line.kind === "revise") {
        emit(i, "the umpires' revision", [revision({ overs: line.overs ?? null, target: line.target ?? null, reason: "rain" })]);
        continue;
      }
      if (line.kind === "declare") {
        emit(i, "the declaration", [sealInnings(innAt(i), INNINGS_END_REASON.DECLARED)]);
        continue;
      }
      fill();
      emit(i, `over by ${line.bowler}`, [bowler({ bowler: idOf(other, /** @type {string} */ (line.bowler)) })]);
      for (const step of /** @type {Step[]} */ (line.steps)) {
        const what = `"${step.text}" (line ${line.at})`;
        if (innAt(i).complete) { problems.push(`${book.match} innings ${i + 1}: ${what} after the innings was over`); continue; }
        switch (step.kind) {
          case "ball": fill(); emit(i, what, deliveryEvents(innAt(i), i, other, /** @type {Delivery} */ (step.d))); break;
          case "rh": emit(i, what, [retire({ batter: idOf(side, /** @type {string} */ (step.who)), reason: RETIRE_REASON.HURT })]); break;
          case "rto": emit(i, what, [retire({ batter: idOf(side, /** @type {string} */ (step.who)), reason: RETIRE_REASON.OUT })]); break;
          case "timed": used.add(/** @type {string} */ (step.who));
            emit(i, what, [retire({ batter: idOf(side, /** @type {string} */ (step.who)), reason: RETIRE_REASON.TIMED_OUT })]); break;
          case "back": {
            const inn = innAt(i);
            const id = idOf(side, /** @type {string} */ (step.who));
            emit(i, what, [batters(inn.striker == null ? { striker: id } : { nonStriker: id })]);
            break;
          }
          case "pen": emit(i, what, [penalty({ runs: 5, toBattingTeam: /** @type {number} */ (step.runs) > 0, reason: step.reason })]); break;
          case "bw": emit(i, what, [bowler({ bowler: idOf(other, /** @type {string} */ (step.who)), reason: step.reason })]); break;
          // suspension.js bowlerToSuspend() and suspendEvent(): the bowler on (or who bowled the last ball), the reason, the match's Edition.
          case "susp": {
            const cur = innAt(i);
            const who = cur.bowler ?? (cur.ballLog ?? []).at(-1)?.bowlerId ?? null;
            emit(i, what, [bowlerSuspended(/** @type {any} */ ({ bowler: who, reason: step.reason, edition: lawsEdition(view()) }))]);
            break;
          }
          // engine.jsx addKeeper(): keeperEvent({keeper: id}).
          case "kp": emit(i, what, [keeper({ keeper: idOf(other, /** @type {string} */ (step.who)) })]); break;
          default: break;
        }
      }
    }
    const inn = innAt(i);
    const declared = paper.lines.some((l) => l.kind === "declare");
    if (!declared) {
      if (!inn.complete) problems.push(`${book.match} innings ${i + 1}: the paper ends but the innings is not over (${inn.runs}/${inn.wickets} in ${fmtOvers(inn.balls)})`);
      else emit(i, "the seal", [sealInnings(inn)]);
    }
  });
  return { byInnings, log, problems };
}

/** The paper's way of writing a dismissal, as the fold writes it. @param {string} howOut */
const canonicalHowOut = (howOut) => {
  const cb = /^c\s*&\s*b (\S+)$/.exec(howOut);
  return cb ? `c ${cb[1]} b ${cb[1]}` : howOut;
};

/**
 * Hold one innings of the fold to its card.
 * @param {string} match @param {any} inn  the fold's innings @param {Card} card
 * @returns {string[]}  "INV-01 innings 1 · bat B3 runs: expected 12, got 11", one per mismatch
 */
export function compareCard(match, inn, card) {
  /** @type {string[]} */
  const out = [];
  const at = `${match} innings ${card.innings}`;
  const eq = (/** @type {string} */ field, /** @type {unknown} */ want, /** @type {unknown} */ got) => {
    if (want !== got) out.push(`${at} · ${field}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  if (!inn) { out.push(`${at}: the fold has no such innings`); return out; }
  eq("total", card.total, inn.runs);
  eq("wickets", card.wickets, inn.wickets);
  eq("overs", card.overs, fmtOvers(inn.balls));
  eq("extras b", card.extras.b, inn.extras.bye);
  eq("extras lb", card.extras.lb, inn.extras.legBye);
  eq("extras w", card.extras.w, inn.extras.wide);
  eq("extras nb", card.extras.nb, inn.extras.noBall);
  eq("extras p", card.extras.p, inn.extras.penalty);

  eq("batters, in the order they came in", card.batting.map((b) => b.who).join(" "), inn.batsmen.map((/** @type {any} */ b) => b.name).join(" "));
  for (const want of card.batting) {
    const got = inn.batsmen.find((/** @type {any} */ b) => b.name === want.who);
    if (!got) continue;
    eq(`bat ${want.who} runs`, want.runs, got.runs);
    eq(`bat ${want.who} balls`, want.balls, got.balls);
    eq(`bat ${want.who} 4s`, want.fours, got.fours);
    eq(`bat ${want.who} 6s`, want.sixes, got.sixes);
    const how = got.status === "batting" ? "not out" : got.dismissal;
    eq(`bat ${want.who} how out`, canonicalHowOut(want.howOut), how);
  }

  eq("bowlers, in the order they came on", card.bowling.map((b) => b.who).join(" "), inn.bowlers.map((/** @type {any} */ b) => b.name).join(" "));
  for (const want of card.bowling) {
    const got = inn.bowlers.find((/** @type {any} */ b) => b.name === want.who);
    if (!got) continue;
    eq(`bowl ${want.who} overs`, fmtOvers(ballsOf(want.overs)), fmtOvers(got.balls));
    eq(`bowl ${want.who} maidens`, want.maidens, got.maidens);
    eq(`bowl ${want.who} runs`, want.runs, got.runs);
    eq(`bowl ${want.who} wickets`, want.wickets, got.wickets);
    eq(`bowl ${want.who} wides`, want.wides, got.wides);
    eq(`bowl ${want.who} no-balls`, want.noBalls, got.noBalls);
  }

  eq("keepers, in the order they kept", card.keepers.map((k) => k.who).join(" "), (inn.keepers ?? []).map((/** @type {any} */ k) => k.name).join(" "));
  for (const want of card.keepers) {
    const got = (inn.keepers ?? []).find((/** @type {any} */ k) => k.name === want.who);
    if (!got) continue;
    eq(`keeper ${want.who} catches`, want.catches, got.catches);
    eq(`keeper ${want.who} stumpings`, want.stumpings, got.stumpings);
  }

  eq("falls of wicket", card.fow.length, inn.fow.length);
  card.fow.forEach((want, k) => {
    const got = inn.fow[k];
    if (!got) return;
    eq(`fow ${k + 1}`, `${want.wicket}-${want.runs} ${want.who} ${want.over}`, `${got.wickets}-${got.runs} ${got.batsman} ${got.overs}`);
  });
  return out;
}

/**
 * A scorebook proved: built, folded once, every card compared, the result read.
 * @param {Scorebook} book
 * @returns {{built: Built, match: ReturnType<typeof deriveMatch>, mismatches: string[]}}
 */
export function prove(book) {
  const built = buildLog(book);
  const match = deriveMatch(built.log, contextOf(book));
  const mismatches = [...built.problems];
  for (const card of book.cards) mismatches.push(...compareCard(book.match, match.innings[card.innings - 1], card));
  // The milestones a card states (opt-in): the facts the fold gives, innings by innings.
  if (book.cards.some((c) => c.milestones.length)) {
    const facts = deriveFacts(built.log, () => true, { ctx: contextOf(book) });
    for (const card of book.cards) {
      if (!card.milestones.length) continue;
      const paper = book.innings[card.innings - 1];
      const other = book.sides[0] === paper.side ? book.sides[1] : book.sides[0];
      const key = (/** @type {string} */ kind, /** @type {string} */ who, /** @type {number} */ value) => `${kind} ${who} ${value}`;
      const want = card.milestones.map((m) => key(m.kind, m.who, m.value)).sort();
      const got = facts.milestones.filter((m) => m.innings === card.innings - 1).map((m) => {
        const bowlerKind = m.kind === "five_for" || m.kind === "hat_trick";
        return key(m.kind, m.player.slice((bowlerKind ? other : paper.side).length + 1), m.value);
      }).sort();
      if (want.join("; ") !== got.join("; ")) mismatches.push(`${book.match} innings ${card.innings} · milestones: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }
  if (book.cards.length !== match.innings.length) mismatches.push(`${book.match}: ${book.cards.length} cards for ${match.innings.length} innings`);
  const text = match.result?.text ?? null;
  if (text !== book.result) mismatches.push(`${book.match} · result: expected ${JSON.stringify(book.result)}, got ${JSON.stringify(text)}`);
  return { built, match, mismatches };
}
