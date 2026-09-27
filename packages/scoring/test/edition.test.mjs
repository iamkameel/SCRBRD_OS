/**
 * The Laws, 4th Edition (2026), in force from 1 October 2026 — SCRBRD-113.
 *
 * The Edition follows the match date (Kameel, 2026-09-27): a match dated 30
 * September 2026 is scored under the 3rd Edition, one dated 1 October under
 * the 4th. Every rule that differs is asked here of both, side by side, and
 * every judgement of both sides of the wire — MatchFold.view() (the server)
 * and deriveInningsList() (the pad) — which must agree, as laws.test.mjs
 * asks them.
 *
 *   A. The Edition: the fixture's date, else the log's first event, in SAST
 *   B. Suspensions: a deliberate front-foot no-ball and a deliberate beamer
 *      for the match (4th), the innings (3rd); throwing; Level 4 conduct
 *   C. Who faces next: short running and an obstructed catch (4th), a
 *      fielder's obstruction of a batter (both)
 *   D. Penalty runs after a result: taken (4th), reopening a chase; a win
 *      by penalty runs
 *   E. A delivery that does not count in the over (17.3.2.5, both)
 *   F. Runs disallowed on the delivery: 41.14.3 and 41.15.3 (both)
 *
 *   node packages/scoring/test/edition.test.mjs
 */
import {
  deriveInnings, deriveMatch, deriveInningsList, MatchFold, lawsRefusal, REFUSAL,
  inningsStart, batters, bowler, ball, penalty, sealInnings,
  BALL_TYPE, DISMISSAL, KIND, INNINGS_END_REASON,
  bowlerSuspended, suspendedBowlers, suspensionWords, suspensionScope, SUSPENSION_REASON, SUSPENSION_REASON_TEXT,
  SUSPENSION_REASON_SCOPE,
  shortRunning, runsDisallowed, notInOverDelivery, countsInOver, isMaiden, NOT_IN_OVER, RUNS_DISALLOWED,
  FACES_NEXT, PENALTY_REASON, penaltyReasonWords,
  lawsEdition, lawsEditionOn, matchDay, firstEventTs, LAWS_EDITION, FOURTH_EDITION_FROM,
  toRow, fromRow,
} from "../src/index.mjs";

/** @import { LogEvent, InningsStartInput } from "../src/events.mjs" */
/** @import { MatchView } from "../src/laws.mjs" */

let pass = 0, fail = 0;
/** @param {string} n  @param {unknown} c  @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 240)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

// 10:00 SAST on each day.
const SEP30 = Date.parse("2026-09-30T08:00:00Z");
const OCT1 = Date.parse("2026-10-01T08:00:00Z");
const DAYS = /** @type {const} */ ([[3, SEP30, "30 Sep"], [4, OCT1, "1 Oct"]]);

const SQ_A = ["p1", "p2", "p3", "p4", "p5"].map((id) => ({ id, name: id.toUpperCase() }));
const SQ_B = ["w1", "w2", "w3", "w4", "w5"].map((id) => ({ id, name: id.toUpperCase() }));

let n = 0;
/**
 * A match on one day: every event gets an id, an innings and that day's time,
 * the way the scorer's emit() stamps them.
 * @param {number} day  ms
 */
function on(day) {
  /** @param {number} innings  @param {...LogEvent} evs  @returns {(LogEvent & {innings: number, id: string})[]} */
  const at = (innings, ...evs) => evs.map((e) => ({ ...e, innings, id: e.id ?? `e${++n}`, clientTs: day }));
  const open = (innings = 0, /** @type {InningsStartInput} */ o = {}) => at(innings,
    inningsStart({ battingTeam: innings % 2 ? "B" : "A", bowlingTeam: innings % 2 ? "A" : "B",
                   squad: innings % 2 ? SQ_B : SQ_A, bowlingSquad: innings % 2 ? SQ_A : SQ_B, overs: 2, ...o }),
    batters(innings % 2 ? { striker: "w1", nonStriker: "w2" } : { striker: "p1", nonStriker: "p2" }),
    bowler({ bowler: innings % 2 ? "p5" : "w1" }));
  /** @param {number} innings  @param {...number} vs */
  const runs = (innings, ...vs) => at(innings, ...vs.map((v) => ball({ type: BALL_TYPE.RUN, value: v })));
  return { at, open, runs };
}

/**
 * The pad's view: per-innings logs folded by deriveInningsList().
 * @param {LogEvent[]} log  @param {object} [ctx]
 * @returns {MatchView}
 */
function clientView(log, ctx = {}) {
  /** @type {LogEvent[][]} */
  const events = [];
  for (const e of log) (events[e.innings ?? 0] ??= []).push(e);
  const byInnings = [...events].map((l) => l ?? []);
  return { events: byInnings, innings: deriveInningsList(byInnings, ctx) };
}

/**
 * Ask both sides; a disagreement is a failure of its own.
 * @param {LogEvent[]} log  @param {LogEvent} ev  @param {string} [label]  @param {object} [ctx]
 */
function judge(log, ev, label = "", ctx = {}) {
  const server = lawsRefusal(new MatchFold(log, ctx).view(), ev);
  const client = lawsRefusal(clientView(log, ctx), ev);
  ok(`server and pad agree${label ? ` (${label})` : ""}`, server === client, { server, client });
  return server;
}

// ── A. The Edition ────────────────────────────────────────────────
group("A. Which Edition: the fixture's date, else the first event; SAST");
{
  ok("a bare date is itself", matchDay("2026-10-01") === "2026-10-01" && matchDay("nonsense") === null && matchDay(null) === null);
  ok("30 September is the 3rd Edition, 1 October the 4th",
     lawsEditionOn("2026-09-30") === 3 && lawsEditionOn("2026-10-01") === 4 && FOURTH_EDITION_FROM === "2026-10-01");
  ok("dated in South Africa: 00:30 SAST on 1 October is the 4th, though it is 30 September in UTC",
     lawsEditionOn("2026-09-30T22:30:00Z") === 4 && lawsEditionOn("2026-09-30T21:59:59Z") === 3
     && lawsEditionOn(Date.parse("2026-10-01T00:30:00+02:00")) === 4);
  ok("a timestamptz as Postgres sends it", lawsEditionOn("2026-10-01 09:00:00+02") === 4 || lawsEditionOn("2026-10-01T09:00:00+02:00") === 4);

  const A = on(SEP30), B = on(OCT1);
  const l3 = A.open(0), l4 = B.open(0);
  ok("the first event dates a match with no fixture", lawsEdition({ events: [l3] }) === 3 && lawsEdition({ events: [l4] }) === 4
     && lawsEdition({ events: l4 }) === 4 && firstEventTs([[], l3]) === SEP30);
  ok("the fixture's start wins over the first event",
     lawsEdition({ startsAt: "2026-10-01T09:00:00+02:00", events: [l3] }) === 4
     && lawsEdition({ startsAt: "2026-09-30", events: [l4] }) === 3);
  ok("the fold stamps every innings with the match's Edition",
     deriveMatch(l3).innings[0].lawsEdition === 3 && deriveMatch(l4).innings[0].lawsEdition === 4
     && deriveInnings(l4).lawsEdition === 4 && new MatchFold(l4).view().innings[0].lawsEdition === 4);
  ok("...and lawsEdition() reads it back from the fold", lawsEdition(clientView(l4)) === 4 && lawsEdition(new MatchFold(l3).view()) === 3);
  ok("the fold dates by the fixture when told it",
     deriveMatch(l4, { startsAt: "2026-09-30" }).innings[0].lawsEdition === 3
     && new MatchFold(l3, { startsAt: "2026-10-01" }).view().innings[0].lawsEdition === 4
     && deriveInningsList([l3], { startsAt: "2026-10-01" })[0]?.lawsEdition === 4);

  // A two-day match: the first day 30 September, the second 1 October.
  const two = [...A.open(0), ...A.runs(0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), ...B.open(1, { target: 2 })];
  const m = deriveMatch(two);
  ok("a match that started on 30 September is the 3rd Edition's on its second day too",
     m.innings[0].lawsEdition === 3 && m.innings[1].lawsEdition === 3
     && new MatchFold(two).view().innings[1].lawsEdition === 3 && clientView(two).innings[1]?.lawsEdition === 3);

  // A server fold opened on an empty log, the first event pushed later.
  const f = new MatchFold([]);
  for (const e of l4) f.push(e);
  ok("a fold opened empty is dated by the first event pushed", f.view().innings[0].lawsEdition === 4);
  ok("an empty match is under the Edition in force now", lawsEdition({ innings: [], events: [] }) === lawsEditionOn(Date.now()));
  ok("the two Editions", LAWS_EDITION.THIRD === 3 && LAWS_EDITION.FOURTH === 4);
}

// ── B. Suspensions ────────────────────────────────────────────────
group("B. A deliberate front-foot no-ball and a deliberate beamer: the match (4th), the innings (3rd)");
{
  ok("the constructor: 3rd Edition, both for the innings",
     bowlerSuspended({ bowler: "w1", reason: "deliberate_no_ball", edition: 3 }).scope === "innings"
     && bowlerSuspended({ bowler: "w1", reason: "deliberate_beamer", edition: 3 }).scope === "innings");
  ok("...4th Edition, both for the match",
     bowlerSuspended({ bowler: "w1", reason: "deliberate_no_ball", edition: 4 }).scope === "match"
     && bowlerSuspended({ bowler: "w1", reason: "deliberate_beamer", edition: 4 }).scope === "match");
  ok("...the dangerous series (41.7.4) stays for the innings in both",
     bowlerSuspended({ bowler: "w1", reason: "beamers", edition: 3 }).scope === "innings"
     && bowlerSuspended({ bowler: "w1", reason: "beamers", edition: 4 }).scope === "innings");
  ok("...throwing (21.3.2) for the innings, a Level 4 conduct offence and ball tampering for the match, in both",
     [3, 4].every((e) => suspensionScope("throwing", e) === "innings" && suspensionScope("conduct", e) === "match"
       && suspensionScope("ball_tampering", e) === "match"));
  ok("...only those two differ between the Editions",
     Object.values(SUSPENSION_REASON).filter((r) => suspensionScope(r, 3) !== suspensionScope(r, 4)).sort().join() === "deliberate_beamer,deliberate_no_ball");
  ok("...every reason has a scope in both tables and words with no clause number",
     Object.values(SUSPENSION_REASON).every((r) => r in SUSPENSION_REASON_SCOPE[3] && r in SUSPENSION_REASON_SCOPE[4]
       && typeof SUSPENSION_REASON_TEXT[r] === "string" && !/\bLaws?\s+\d/.test(SUSPENSION_REASON_TEXT[r])));
  ok("without an edition, the event's own day decides",
     bowlerSuspended({ bowler: "w1", reason: "deliberate_no_ball", clientTs: OCT1 }).scope === "match"
     && bowlerSuspended({ bowler: "w1", reason: "deliberate_no_ball", clientTs: SEP30 }).scope === "innings");
  let threw = 0;
  try { bowlerSuspended({ bowler: "w1", reason: "deliberate_no_ball", edition: 4, scope: "innings" }); } catch { threw++; }
  try { bowlerSuspended({ bowler: "w1", reason: "deliberate_no_ball", edition: 3, scope: "match" }); } catch { threw++; }
  ok("a scope the Edition does not give is not built", threw === 2);

  for (const [ed, day, label] of DAYS) {
    const { at, open, runs } = on(day);
    const over1 = [...open(0, { overs: 3 }), ...runs(0, 0, 0, 0, 0, 0, 0)];
    const twoIn = [...over1, ...at(0, bowler({ bowler: "w2" })), ...runs(0, 0, 1)];
    /** @param {string} reason  @param {string | undefined} scope */
    const raw = (reason, scope) => /** @type {LogEvent} */ (/** @type {unknown} */ (
      { kind: KIND.BOWLER_SUSPENDED, bowler: "w2", reason, ...(scope ? { scope } : {}) }));
    const want = ed === 4 ? "match" : "innings", other = ed === 4 ? "innings" : "match";
    ok(`${label}: a deliberate front-foot no-ball for the ${want} is taken`, judge(twoIn, at(0, raw("deliberate_no_ball", want))[0], label) === null);
    ok(`${label}: ...for the ${other} is refused`, judge(twoIn, at(0, raw("deliberate_no_ball", other))[0], label) === REFUSAL.SUSPENSION_UNKNOWN);
    ok(`${label}: a deliberate beamer the same`, judge(twoIn, at(0, raw("deliberate_beamer", want))[0], label) === null
       && judge(twoIn, at(0, raw("deliberate_beamer", other))[0], label) === REFUSAL.SUSPENSION_UNKNOWN);
    ok(`${label}: with no scope, taken only where the Law's scope is the innings`,
       judge(twoIn, at(0, raw("deliberate_no_ball", undefined))[0], label) === (ed === 3 ? null : REFUSAL.SUSPENSION_UNKNOWN)
       && judge(twoIn, at(0, raw("beamers", undefined))[0], label) === null);
    ok(`${label}: the pad's event, built with the match's Edition, is the one the server takes`,
       judge(twoIn, at(0, bowlerSuspended({ bowler: "w2", reason: "deliberate_no_ball", edition: lawsEdition(clientView(twoIn)) }))[0], label) === null);

    // A's first innings, B's, then A's second: may w2 bowl in A's second?
    const susp = at(0, bowlerSuspended({ bowler: "w2", reason: "deliberate_no_ball", edition: ed }))[0];
    const first = [...twoIn, susp, ...at(0, bowler({ bowler: "w3", reason: "suspended" })), ...runs(0, 0, 0, 0, 0),
                   ...at(0, bowler({ bowler: "w4" })), ...runs(0, 0, 0, 0, 0, 0, 0)];
    const B1 = [...at(1, inningsStart({ battingTeam: "B", bowlingTeam: "A", squad: SQ_B, bowlingSquad: SQ_A, overs: 1 }),
                     batters({ striker: "w1", nonStriker: "w2" }), bowler({ bowler: "p5" })), ...runs(1, 0, 0, 0, 0, 0, 0)];
    const A2 = [...first, ...B1, ...at(2, inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, bowlingSquad: SQ_B, overs: 2 }),
                                         batters({ striker: "p1", nonStriker: "p2" }))];
    ok(`${label}: in A's second innings the bowler is ${ed === 4 ? "still suspended" : "free to bowl"}`,
       judge(A2, at(2, bowler({ bowler: "w2" }))[0], label) === (ed === 4 ? REFUSAL.BOWLER_SUSPENDED : null));
    ok(`${label}: ...and the fold's record carries the scope it was recorded with`,
       new MatchFold(A2).view().innings[0].suspensions[0]?.scope === want
       && suspendedBowlers(new MatchFold(A2).view().innings, 2).has("w2") === (ed === 4));
  }

  // STORED EVENTS KEEP THEIR SCOPE. A 3rd-Edition suspension (innings) in a
  // log the fold reads as the 4th — an event written before this build, or
  // re-dated — still reads as the innings: the fold reads the event's scope.
  const { at, open, runs } = on(OCT1);
  const stored = [...open(0, { overs: 3 }), ...runs(0, 0, 0),
    ...at(0, /** @type {LogEvent} */ ({ kind: KIND.BOWLER_SUSPENDED, bowler: "w1", reason: "beamers", scope: "innings" }))];
  ok("a stored `beamers` suspension keeps its scope", deriveInnings(stored).suspensions[0]?.scope === "innings"
     && suspensionWords({ reason: "beamers", scope: "innings" }).endsWith("for the rest of the innings."));
  ok("a stored suspension for the match reads so", suspensionWords({ reason: "deliberate_no_ball", scope: "match" }).endsWith("for the rest of the match."));
  ok("the words carry no clause number, for every reason in both Editions",
     Object.values(SUSPENSION_REASON).every((r) => [3, 4].every((e) => !/\d+\.\d+/.test(suspensionWords(bowlerSuspended({ bowler: "w1", reason: r, edition: e }))))));
  ok("through the wire and back, the scope is the event's",
     /** @type {any} */ (fromRow(toRow({ ...bowlerSuspended({ bowler: "w1", reason: "deliberate_beamer", edition: 4 }), innings: 0 }))).scope === "match");
}

// ── C. Who faces next ─────────────────────────────────────────────
group("C. Who faces next: after short running and an obstructed catch (4th), after a fielder obstructs a batter (both)");
{
  let threw = 0;
  try { ball({ facesNext: "bowler" }); } catch { threw++; }
  try { ball({ type: BALL_TYPE.RUN, facesNext: "incoming" }); } catch { threw++; }
  ok("the constructor refuses a value it does not know, and 'incoming' with no wicket", threw === 2);
  ok("...and omits the field when nobody chose", !("facesNext" in ball({})) && ball({ facesNext: "non_striker" }).facesNext === "non_striker");

  for (const [ed, day, label] of DAYS) {
    const { at, open, runs } = on(day);
    // p1 on strike, p2 at the other end, two dots.
    const L = [...open(0), ...runs(0, 0, 0)];
    const [dotNS, awardNS] = at(0, ...shortRunning({ type: BALL_TYPE.RUN, value: 2, facesNext: FACES_NEXT.NON_STRIKER }));
    const [dotS, awardS] = at(0, ...shortRunning({ type: BALL_TYPE.RUN, value: 2, facesNext: FACES_NEXT.STRIKER }));
    const [dot, award] = at(0, ...shortRunning({ type: BALL_TYPE.RUN, value: 2 }));
    if (ed === 4) {
      ok(`${label}: short running, the fielding captain's choice is taken`, judge(L, dotNS, label) === null && judge([...L, dotNS], awardNS, label) === null);
      const inn = deriveInnings([...L, dotNS, awardNS]);
      ok(`${label}: ...the non-striker faces the next ball`, inn.striker === "p2" && inn.nonStriker === "p1" && inn.runs === 0 && inn.balls === 3);
      ok(`${label}: ...or the striker again`, deriveInnings([...L, dotS, awardS]).striker === "p1");
      // On the last ball of the over: the choice is who faces the first ball of the next.
      const five = [...open(0), ...runs(0, 0, 0, 0, 0, 0)];
      const [l6, a6] = at(0, ...shortRunning({ type: BALL_TYPE.RUN, value: 1, facesNext: FACES_NEXT.STRIKER }));
      const endOver = deriveInnings([...five, l6, a6]);
      ok(`${label}: on the over's last ball, the striker chosen faces the next over from the other end`,
         endOver.balls === 6 && endOver.striker === "p1" && endOver.nonStriker === "p2" && endOver.bowler === null);
      const noChoice = deriveInnings([...five, ...at(0, ...shortRunning({ type: BALL_TYPE.RUN, value: 1 }))]);
      ok(`${label}: ...without a choice the ends change as at any over's end`, noChoice.striker === "p2");
      ok(`${label}: a choice on a delivery that scored is not the Laws'`,
         judge(L, at(0, ball({ type: BALL_TYPE.RUN, value: 1, facesNext: "non_striker" }))[0], label) === REFUSAL.FACES_NEXT_NOT_A_CHOICE);
    } else {
      ok(`${label}: short running, the batters go back to their ends: a choice is refused`,
         judge(L, dotNS, label) === REFUSAL.FACES_NEXT_NOT_A_CHOICE);
      const inn = deriveInnings([...L, dot, award]);
      ok(`${label}: ...without one, taken, and the striker faces again`, judge(L, dot, label) === null && judge([...L, dot], award, label) === null
         && inn.striker === "p1" && inn.nonStriker === "p2");
    }
    ok(`${label}: 'incoming' on a delivery with no wicket is nobody`,
       judge(L, at(0, /** @type {LogEvent} */ ({ ...ball({}), facesNext: "incoming" }))[0], label) === REFUSAL.FACES_NEXT_UNKNOWN);
    ok(`${label}: an unknown value is refused`,
       judge(L, at(0, /** @type {LogEvent} */ (/** @type {unknown} */ ({ ...ball({}), facesNext: "keeper" })))[0], label) === REFUSAL.FACES_NEXT_UNKNOWN);

    // OBSTRUCTING THE FIELD, preventing a catch (37.5.2): no runs; the
    // fielding captain chooses the non-striker or the incoming batter.
    const obs = (/** @type {string | undefined} */ f) => at(0, ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: DISMISSAL.OBSTRUCTING_FIELD, ...(f ? { facesNext: f } : {}) }))[0];
    const plain = deriveInnings([...L, obs(undefined)]);
    ok(`${label}: an obstruction with no choice empties the striker's end, as every one did`, plain.striker === null && plain.nonStriker === "p2");
    if (ed === 4) {
      ok(`${label}: the incoming batter chosen: taken`, judge(L, obs("incoming"), label) === null);
      const inc = deriveInnings([...L, obs("incoming")]);
      ok(`${label}: ...the striker's end is his, the non-striker stays`, inc.striker === null && inc.nonStriker === "p2" && inc.wickets === 1);
      const nsf = [...L, obs("non_striker")];
      ok(`${label}: the non-striker chosen: taken`, judge(L, obs("non_striker"), label) === null);
      const ns = deriveInnings(nsf);
      ok(`${label}: ...he faces; the incoming batter goes to the other end`, ns.striker === "p2" && ns.nonStriker === null);
      ok(`${label}: ...who then comes in at the non-striker's end`, judge(nsf, at(0, batters({ nonStriker: "p3" }))[0], label) === null
         && deriveInnings([...nsf, ...at(0, batters({ nonStriker: "p3" }))]).striker === "p2");
      ok(`${label}: the batter who is out cannot be chosen`, judge(L, obs("striker"), label) === REFUSAL.FACES_NEXT_UNKNOWN);
      ok(`${label}: a wicket that is not the Laws' occasion is no choice`,
         judge(L, at(0, ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: DISMISSAL.BOWLED, facesNext: "incoming" }))[0], label) === REFUSAL.FACES_NEXT_NOT_A_CHOICE);
    } else {
      ok(`${label}: a choice after an obstruction is refused`, judge(L, obs("incoming"), label) === REFUSAL.FACES_NEXT_NOT_A_CHOICE
         && judge(L, obs("non_striker"), label) === REFUSAL.FACES_NEXT_NOT_A_CHOICE);
    }

    // A FIELDER OBSTRUCTING A BATTER (41.5): the batters choose, in both.
    const [ob, obAward] = at(0, ...notInOverDelivery({ type: BALL_TYPE.RUN, value: 1, facesNext: FACES_NEXT.STRIKER }, PENALTY_REASON.OBSTRUCTING_BATTER));
    ok(`${label}: after a fielder obstructs a batter, the batters' choice is taken`, judge(L, ob, label) === null && judge([...L, ob], obAward, label) === null);
    const o = deriveInnings([...L, ob, obAward]);
    ok(`${label}: ...the run in progress counts, and the striker they chose faces`, o.runs === 6 && o.striker === "p1" && o.balls === 2);
  }

  // Old logs: a delivery with no choice folds as it always did.
  const { at, open, runs } = on(OCT1);
  const L = [...open(0), ...runs(0, 0, 3, 1)];
  const a = deriveInnings(L), b = deriveInnings(L.map((e) => ({ ...e })));
  ok("no choice, no change", a.striker === b.striker && a.nonStriker === b.nonStriker && JSON.stringify(a.batsmen) === JSON.stringify(b.batsmen));
  ok("through the wire and back", /** @type {any} */ (fromRow(toRow({ ...ball({ type: BALL_TYPE.WICKET, dismissal: "obstructing_field", facesNext: "incoming" }), innings: 0 }))).facesNext === "incoming");
  void at;
}

// ── D. Penalty runs after a result ────────────────────────────────
group("D. Penalty runs after a result (4th): taken, reopening a chase; a win by penalty runs");
{
  for (const [ed, day, label] of DAYS) {
    const { at, open, runs } = on(day);
    // A make 1; B need 2 and hit 2 off the first ball.
    const decided = [...open(0), ...runs(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1), ...open(1, { target: 2 }), ...runs(1, 2)];
    const toField = at(1, penalty({ toBattingTeam: false, reason: "pitch_damage" }))[0];
    ok(`${label}: the chase is over`, new MatchFold(decided).view().innings[1]?.complete === true);
    ok(`${label}: an award to the fielding side after the result is ${ed === 4 ? "taken" : "refused"}`,
       judge(decided, toField, label) === (ed === 4 ? null : REFUSAL.MATCH_DECIDED));
    if (ed === 4) {
      const reopened = [...decided, toField];
      const m = new MatchFold(reopened).view();
      ok(`${label}: ...A's total and B's target rise by five, and the chase is on again`,
         m.innings[0].runs === 6 && m.innings[1].target === 7 && m.innings[1].complete === false && deriveMatch(reopened).result === null);
      ok(`${label}: ...so the next ball is taken`, judge(reopened, at(1, ball({}))[0], label) === null);
      const won = [...reopened, ...runs(1, 4, 1)];
      ok(`${label}: ...and the chase can be won again`, deriveMatch(won).result?.margin === "4 wickets" && deriveMatch(won).result?.winner === "B");
    }

    // SEALED: the scorer confirmed the winning innings before the award.
    const sealed = [...decided, ...at(1, sealInnings(deriveMatch(decided).innings[1]))];
    ok(`${label}: the sealed chase stands sealed`, deriveMatch(sealed).innings[1].sealed === true);
    const after = [...sealed, toField];
    const f = deriveMatch(after).innings[1];
    if (ed === 4) {
      ok(`${label}: an award that lifts the target above a sealed chase reopens it`,
         f.sealed === false && f.complete === false && f.endReason === null && f.target === 7);
      ok(`${label}: ...on both sides of the wire`, new MatchFold(after).view().innings[1].complete === false
         && clientView(after).innings[1]?.complete === false && judge(after, at(1, ball({}))[0], label) === null);
      // An award that leaves the target within reach does not reopen it.
      const four = [...open(0), ...runs(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1), ...open(1, { target: 2 }), ...runs(1, 4)];
      const fourSealed = [...four, ...at(1, sealInnings(deriveMatch(four).innings[1]))];
      const small = deriveMatch([...fourSealed, ...at(1, penalty({ toBattingTeam: false, reason: "other", runs: 2 }))]).innings[1];
      ok(`${label}: ...one that leaves the runs still enough does not`, small.sealed === true && small.complete === true && small.target === 4);
    } else {
      ok(`${label}: an award already in a 3rd-Edition log does not reopen a sealed chase (it replays as it did)`,
         f.sealed === true && f.complete === true && f.endReason === INNINGS_END_REASON.TARGET);
    }

    // An award that does not undo the result: the chase ended short.
    const short = [...open(0), ...runs(0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0), ...open(1, { target: 4 }), ...runs(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0)];
    ok(`${label}: B finish their overs 3 short`, deriveMatch(short).result?.winner === "A" && deriveMatch(short).result?.margin === "2 runs");
    ok(`${label}: an award to A after it ${ed === 4 ? "is taken, and the margin grows" : "is refused"}`,
       ed === 4 ? judge(short, at(1, penalty({ toBattingTeam: false, reason: "time_wasting" }))[0], label) === null
                  && deriveMatch([...short, ...at(1, penalty({ toBattingTeam: false, reason: "time_wasting" }))]).result?.margin === "7 runs"
                : judge(short, at(1, penalty({ toBattingTeam: false, reason: "time_wasting" }))[0], label) === REFUSAL.MATCH_DECIDED);

    // 16.7: the chase completed short, an award to B makes it enough.
    const toBat = at(1, penalty({ toBattingTeam: true, reason: "helmet_struck" }))[0];
    ok(`${label}: an award to the batting side after the result is taken in both`, judge(short, toBat, label) === null);
    const r = deriveMatch([...short, toBat]).result;
    ok(`${label}: B's total is now enough: ${ed === 4 ? "a win by penalty runs" : "read as it always was"}`,
       ed === 4 ? r?.winner === "B" && r?.margin === "penalty runs"
                : r?.winner === "B" && r?.margin !== "penalty runs", r);
    ok(`${label}: ...the flag is the fold's, on both sides`,
       deriveMatch([...short, toBat]).innings[1].penaltyWin === (ed === 4)
       && new MatchFold([...short, toBat]).view().innings[1].penaltyWin === (ed === 4));
    // A chase that WON by reaching its target is not a win by penalty runs.
    ok(`${label}: a chase won off the bat is won by wickets`, deriveMatch(decided).result?.margin === "4 wickets");
  }
}

// ── E. A delivery that does not count in the over (17.3.2.5) ──────
group("E. A delivery that does not count in the over: 24.4, 28.2, 41.4, 41.5 (both Editions)");
{
  ok("the four", [...NOT_IN_OVER].sort().join() === "distracting_striker,fielder_returning,illegal_fielding,obstructing_batter");
  let threw = 0;
  try { ball({ notInOver: "helmet_struck" }); } catch { threw++; }
  try { ball({ type: BALL_TYPE.WICKET, dismissal: "run_out", notInOver: "illegal_fielding" }); } catch { threw++; }
  try { notInOverDelivery({}, "pitch_damage"); } catch { threw++; }
  ok("the constructor refuses another reason, a wicket, and an award of another kind", threw === 3);
  const [d, a] = notInOverDelivery({ type: BALL_TYPE.RUN, value: 2 }, "illegal_fielding");
  ok("notInOverDelivery: the delivery marked, then five to the batting side",
     d.kind === "ball" && d.notInOver === "illegal_fielding" && d.value === 2 && a.kind === "penalty" && a.toBattingTeam === true && a.reason === "illegal_fielding" && a.runs === 5);
  ok("countsInOver: a fair ball counts, a wide, a no-ball and a marked one do not; an old one as its type",
     countsInOver({ type: "run" }) && countsInOver({}) && !countsInOver({ type: "Wd" }) && !countsInOver({ type: "Nb" })
     && !countsInOver({ type: "run", notInOver: "illegal_fielding" }) && countsInOver({ type: "run", notInOver: "helmet_struck" }));

  for (const [, day, label] of DAYS) {
    const { at, open, runs } = on(day);
    const L = [...open(0), ...runs(0, 0, 0, 0, 0, 0)];   // five dots
    const [ill, illAward] = at(0, ...notInOverDelivery({ type: BALL_TYPE.RUN, value: 2 }, "illegal_fielding"));
    ok(`${label}: taken, and its award after it`, judge(L, ill, label) === null && judge([...L, ill], illAward, label) === null);
    const inn = deriveInnings([...L, ill, illAward]);
    const w1 = inn.bowlers.find((b) => b.id === "w1");
    const p1 = inn.batsmen.find((b) => b.id === "p1");
    ok(`${label}: not a ball of the over: still five, the bowler still on`, inn.balls === 5 && inn.bowler === "w1" && w1?.balls === 5);
    ok(`${label}: ...its runs stand: two to the striker and the bowler, five to the side`, inn.runs === 7 && p1?.runs === 2 && w1?.runs === 2);
    ok(`${label}: ...the striker received it: a ball faced`, p1?.balls === 6);
    const six = deriveInnings([...L, ill, illAward, ...runs(0, 0)]);
    ok(`${label}: the next ball is the sixth, and ends the over`, six.balls === 6 && six.bowler === null);
    ok(`${label}: an over of six dots and one that does not count is a maiden, if it cost the bowler nothing`,
       isMaiden(deriveInnings([...L, ...at(0, ...notInOverDelivery({ type: BALL_TYPE.RUN, value: 0 }, "distracting_striker")), ...runs(0, 0)]).overLog[0].balls)
       && !isMaiden(six.overLog[0].balls));
    const nb = [...open(0), ...at(0, ball({ type: BALL_TYPE.NO_BALL }))];
    const afterNb = deriveInnings([...nb, ...at(0, ...notInOverDelivery({ type: BALL_TYPE.RUN }, "fielder_returning"))]);
    ok(`${label}: a fair ball that does not count still takes the free hit (by its type, as SQL reads it)`, afterNb.freeHit === false && afterNb.balls === 0);
    ok(`${label}: a no-ball that does not count: its one run stands, as a no-ball`,
       deriveInnings([...open(0), ...at(0, ...notInOverDelivery({ type: BALL_TYPE.NO_BALL, value: 0 }, "obstructing_batter"))]).runs === 6);
    ok(`${label}: an unknown reason is refused, and one on a wicket`,
       judge(L, at(0, /** @type {LogEvent} */ (/** @type {unknown} */ ({ ...ball({}), notInOver: "helmet_struck" })))[0], label) === REFUSAL.NOT_IN_OVER_UNKNOWN
       && judge(L, at(0, /** @type {LogEvent} */ ({ ...ball({ type: BALL_TYPE.WICKET, dismissal: "run_out" }), notInOver: "illegal_fielding" }))[0], label) === REFUSAL.NOT_IN_OVER_UNKNOWN);
    // Old logs: a plain award after a scoring ball is what it always was.
    const plain = deriveInnings([...L, ...runs(0, 2), ...at(0, penalty({ toBattingTeam: true, reason: "illegal_fielding" }))]);
    ok(`${label}: an award alone, as before, leaves the ball in the over`, plain.balls === 6 && plain.runs === 7);
  }
  ok("through the wire and back", /** @type {any} */ (fromRow(toRow({ ...ball({ notInOver: "distracting_striker" }), innings: 0 }))).notInOver === "distracting_striker");
}

// ── F. Runs disallowed: 41.14.3 and 41.15.3 ──────────────────────
group("F. A further offence on the pitch or in the protected area disallows the delivery's runs (both Editions)");
{
  ok("the three", [...RUNS_DISALLOWED].sort().join() === "pitch_damage,short_running,striker_position");
  ok("the striker's position (41.15) is a reason, to the fielding side, with words and no clause number",
     PENALTY_REASON.STRIKER_POSITION === "striker_position" && penaltyReasonWords("striker_position").length > 10
     && !/\d/.test(penaltyReasonWords("striker_position")));
  let threw = 0;
  try { runsDisallowed({}, "helmet_struck"); } catch { threw++; }
  ok("runsDisallowed refuses a reason that disallows nothing", threw === 1);
  for (const [, day, label] of DAYS) {
    const { at, open, runs } = on(day);
    const L = [...open(0), ...runs(0, 0)];
    for (const reason of ["pitch_damage", "striker_position"]) {
      const [dot, award] = /** @type {any[]} */ (at(0, ...runsDisallowed({ type: BALL_TYPE.RUN, value: 3 }, reason)));
      ok(`${label}: ${reason}: the delivery with no runs, then five to the fielding side`,
         dot.value === 0 && award.toBattingTeam === false && award.reason === reason
         && judge(L, dot, label) === null && judge([...L, dot], award, label) === null);
      const inn = deriveInnings([...L, dot, award]);
      ok(`${label}: ${reason}: no runs, the ball counts, the batters at their original ends`,
         inn.runs === 0 && inn.balls === 2 && inn.striker === "p1" && inn.penaltyToFielding === 5);
      ok(`${label}: ${reason}: may also be awarded alone (no delivery)`, judge(L, at(0, penalty({ toBattingTeam: false, reason }))[0], label) === null);
    }
    ok(`${label}: a no-ball's one run stands`,
       deriveInnings([...L, ...at(0, ...runsDisallowed({ type: BALL_TYPE.NO_BALL, value: 2 }, "pitch_damage"))]).runs === 1);
  }
}

console.log("\n" + "─".repeat(52));
console.log(`EDITION: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
