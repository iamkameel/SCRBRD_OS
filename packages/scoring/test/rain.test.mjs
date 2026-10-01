/**
 * Rain: interruptions in the log (SCRBRD-130 R1; docs/design/SCRBRD-130_rain_and_par.md
 * §2, §5):
 *
 *   A. the events: play_stopped and play_resumed carry only what they were
 *      given; a revision without a par is the same bytes it always was; the
 *      wire round trip keeps all three
 *   B. the fold: positions and allotments at each stop and resumption, a
 *      termination by the seal, an open stop; no resource anywhere
 *   C. every log of rain-logs.mjs folds to the result and the per-innings stop
 *      and par the design gives it (the logs smoke-fold-figures holds SQL to)
 *   D. the Laws: each of §2.4's refusals refusing, then the corrected event
 *      accepted; none reads a condition
 *   E. the words: "(DLS)" and "(revised target)" by the frozen method, from the
 *      fold and from match_result()'s row alike; no suffix without a revision
 *   F. MatchFold.view() agrees with deriveMatch() on the stop
 */
import {
  deriveMatch, deriveInnings, MatchFold, lawsRefusal, REFUSAL, REFUSAL_TEXT, likelyCause,
  inningsStart, batters, bowler, ball, penalty, retire, revision, playStopped, playResumed, sealInnings,
  toRow, fromRow, resultFromRow, resultWords, revisedTargetMethod, KIND, BALL_TYPE, STOP_REASONS, deriveCommentary,
} from "../src/index.mjs";
import { RAIN_LOGS, RAIN_SIDES, RAIN_NAMES, RAIN_STARTS_AT, rainLog } from "./rain-logs.mjs";

let pass = 0, fail = 0;
/** @type {(n: string, c: unknown, detail?: unknown) => void} */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${typeof d === "string" ? d : JSON.stringify(d)}`); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
const T = Date.parse("2026-10-10T08:00:00Z");

group("A. The events");
{
  const s = playStopped({ innings: 1, clientTs: T });
  ok("a stop with nothing but its innings is rain, and carries no note and no time", JSON.stringify(s) === JSON.stringify({ kind: "play_stopped", innings: 1, clientTs: T, reason: "rain" }), s);
  const s2 = playStopped({ innings: 0, clientTs: T, reason: "bad_light", note: "  floodlights out  ", at: T + 5 });
  ok("...and a note (trimmed) and a time when given", s2.note === "floodlights out" && s2.at === T + 5 && s2.reason === "bad_light", s2);
  ok("an empty note is no note", !("note" in playStopped({ clientTs: T, note: "   " })));
  const r = playResumed({ innings: 0, clientTs: T });
  ok("a resumption carries no time unless given", JSON.stringify(r) === JSON.stringify({ kind: "play_resumed", innings: 0, clientTs: T }), r);
  const before = revision({ overs: 16, target: 134, clientTs: T });
  ok("a revision without a par has no par key: every revision before R1 is the same bytes",
     !("par" in before) && JSON.stringify(Object.keys(before)) === JSON.stringify(["kind", "innings", "clientTs", "overs", "target", "reason"]), before);
  ok("a revision with a par carries it", revision({ par: 74, clientTs: T }).par === 74);
  const wire = [s2, r, revision({ par: 74, innings: 1, clientTs: T })].map((e) => fromRow({ ...toRow(e), seq: 1 }));
  ok("the wire keeps the reason, note, time and par in the payload",
     wire[0].kind === KIND.PLAY_STOPPED && /** @type {any} */ (wire[0]).reason === "bad_light" && /** @type {any} */ (wire[0]).note === "floodlights out"
     && /** @type {any} */ (wire[0]).at === T + 5 && wire[1].kind === KIND.PLAY_RESUMED && /** @type {any} */ (wire[2]).par === 74, wire);
  ok("the stop reasons are rain, bad light, a wet ground and other",
     [...STOP_REASONS].join(",") === "rain,bad_light,wet_ground,other");
}

group("B. The fold: positions and allotments, no resource");
{
  const [first] = deriveMatch(RAIN_LOGS[0].log, { startsAt: RAIN_STARTS_AT }).innings;
  const x = first.interruptions[0];
  ok("a first innings stopped at 2.0 and resumed at 4 overs: the position, the allotment at the stop and at the resumption",
     first.interruptions.length === 1 && x.over === 2 && x.ball === 0 && x.balls === 12 && x.runs === 12 && x.wickets === 0
     && x.reason === "rain" && x.oversAtStop === 5 && x.oversAtResume === 4 && first.stopped === null, first.interruptions);
  ok("...the innings' overs move with the revision, the balls bowled do not", first.overs === 4 && first.balls === 24 && first.runs === 36);
  ok("...and nothing in the fold is a resource", !JSON.stringify(first.interruptions).includes("resource"));
  const two = deriveMatch(RAIN_LOGS.find((l) => l.name.startsWith("two interruptions"))?.log ?? [], { startsAt: RAIN_STARTS_AT }).innings[0];
  ok("two interruptions, the first mid-over at 0.4 resumed under the same allotment, the second cut to 3",
     two.interruptions.length === 2 && two.interruptions[0].over === 0 && two.interruptions[0].ball === 4
     && two.interruptions[0].oversAtStop === 4 && two.interruptions[0].oversAtResume === 4
     && two.interruptions[1].balls === 12 && two.interruptions[1].reason === "wet_ground" && two.interruptions[1].oversAtResume === 3,
     two.interruptions);
  const term = deriveMatch(RAIN_LOGS.find((l) => l.name.includes("below par"))?.log ?? [], { startsAt: RAIN_STARTS_AT }).innings[1];
  ok("a chase terminated: the seal closes the stop, the allotment at resumption null, and the par is the umpires'",
     term.stopped === null && term.interruptions.length === 1 && term.interruptions[0].oversAtResume === null
     && term.par === 18 && term.endReason === "abandoned" && term.sealed, { i: term.interruptions, par: term.par });
  const open = deriveMatch(RAIN_LOGS.find((l) => l.name.startsWith("a chase stopped and not yet"))?.log ?? [], { startsAt: RAIN_STARTS_AT }).innings[1];
  ok("an open stop: the position at the stop, and the interruption not yet closed",
     open.stopped != null && open.stopped.balls === 5 && open.stopped.runs === 5 && open.interruptions[0].oversAtResume === undefined
     && !open.complete, open.stopped);
  // A log from anywhere still folds: a second stop, a resumption with none open,
  // and a stop in a sealed innings change nothing.
  const base = [inningsStart({ battingTeam: "A", bowlingTeam: "B", overs: 2, squad: [{ id: "a1", name: "a1" }, { id: "a2", name: "a2" }] }),
                batters({ striker: "a1", nonStriker: "a2" }), bowler({ bowler: "b1" }), ball({ type: BALL_TYPE.RUN, value: 1 })];
  const odd = deriveInnings([...base, playResumed({}), playStopped({ clientTs: T }), playStopped({ reason: "other", clientTs: T + 1 })]);
  ok("a resumption with none open, and a second stop while one is open, are ignored by the fold",
     odd.interruptions.length === 1 && odd.stopped?.reason === "rain" && odd.stopped.at === T, odd.interruptions);
  const inn = deriveInnings(base);
  const sealed = deriveInnings([...base, sealInnings(inn, "declared"), playStopped({})]);
  ok("a stop in a sealed innings is ignored", sealed.stopped === null && sealed.interruptions.length === 0);
}

group("C. Every rain log folds to the result and the stops the design gives it");
for (const x of RAIN_LOGS) {
  const m = deriveMatch(x.log, { startsAt: RAIN_STARTS_AT, conditions: x.play ?? undefined, status: x.status, sides: RAIN_SIDES, names: RAIN_NAMES });
  const r = m.result;
  const got = r == null ? { outcome: "in_progress", marginKind: null, marginValue: null, winnerSide: null, text: null }
    : { outcome: r.outcome, marginKind: r.marginKind, marginValue: r.marginValue, winnerSide: r.winnerSide, text: r.text };
  ok(x.name, JSON.stringify(got) === JSON.stringify(x.expect), { got, expect: x.expect });
  const inns = m.innings.map((i) => ({ stopped: i.stopped != null, par: i.par, stops: i.interruptions.length }));
  ok("...and each innings' stop and par", JSON.stringify(inns) === JSON.stringify(x.innings), { got: inns, expect: x.innings });
}
ok("the list covers the design's parity list: at least 14 logs", RAIN_LOGS.length >= 14, RAIN_LOGS.length);
{
  // Careers move exactly as the balls say: a stop and a resumption change no figure.
  const plain = rainLog([{ bat: "1XI", bowl: "Kearsney", overs: 5, steps: [1, 4, "W", 2, 6, 0, 1, 1] }]);
  const wet = rainLog([{ bat: "1XI", bowl: "Kearsney", overs: 5, steps: [1, 4, "W", { stop: "rain" }, { resume: true }, 2, 6, 0, 1, 1] }]);
  const a = deriveMatch(plain).innings[0], b = deriveMatch(wet).innings[0];
  const card = (/** @type {any} */ i) => JSON.stringify([i.runs, i.wickets, i.balls, i.batsmen.map((/** @type {any} */ x) => [x.id, x.runs, x.balls, x.fours, x.sixes, x.status]),
    i.bowlers.map((/** @type {any} */ x) => [x.id, x.balls, x.runs, x.wickets]), i.fow, i.partnerships]);
  ok("a stop and a resumption change no batting, bowling or partnership figure (careers move as the balls say)", card(a) === card(b), { a: card(a), b: card(b) });
}

group("D. The Laws: each refusal refusing, then the corrected event accepted");
{
  const sq = [{ id: "a1", name: "A One" }, { id: "a2", name: "A Two" }, { id: "a3", name: "A Three" }];
  /** @type {any[]} */
  const log = [inningsStart({ battingTeam: "1XI", bowlingTeam: "Kearsney", overs: 5, squad: sq, clientTs: T }),
               batters({ striker: "a1", nonStriker: "a2", clientTs: T })].map((e, k) => ({ ...e, id: `d:${k}` }));
  const view = () => new MatchFold(log, { startsAt: RAIN_STARTS_AT }).view();
  const push = (/** @type {any} */ e) => log.push({ ...e, id: `d:${log.length}` });
  const asked = (/** @type {any} */ e) => lawsRefusal(view(), e);
  /** Bowl n singles, a bowler named at the start of each over, k1 and k2 in turn. @param {number} n */
  const bowl = (n) => {
    for (let k = 0; k < n; k++) {
      const b = view().innings[0]?.balls ?? 0;
      if (b % 6 === 0) push(bowler({ bowler: (b / 6) % 2 ? "k2" : "k1", clientTs: T + log.length }));
      push(ball({ type: BALL_TYPE.RUN, value: 1, clientTs: T + log.length }));
    }
  };
  bowl(9);

  ok("PLAY_NOT_STOPPED: a resumption with no stop open", asked(playResumed({})) === REFUSAL.PLAY_NOT_STOPPED);
  ok("STOP_OUTSIDE_INNINGS: a stop naming an innings not started", asked(playStopped({ innings: 1 })) === REFUSAL.STOP_OUTSIDE_INNINGS);
  ok("...the stop in the innings in play is accepted", asked(playStopped({})) === null);
  push(playStopped({ clientTs: T + 20 }));
  ok("PLAY_ALREADY_STOPPED: a second stop while one is open", asked(playStopped({})) === REFUSAL.PLAY_ALREADY_STOPPED);
  ok("PLAY_STOPPED: a ball while play is stopped", asked(ball({ type: BALL_TYPE.RUN, value: 1 })) === REFUSAL.PLAY_STOPPED);
  ok("PLAY_STOPPED: a wicket", asked(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })) === REFUSAL.PLAY_STOPPED);
  ok("PLAY_STOPPED: a retirement", asked(retire({ batter: "a1", reason: "hurt" })) === REFUSAL.PLAY_STOPPED);
  ok("PLAY_STOPPED: a bowler change", asked(bowler({ bowler: "k1", reason: "injury" })) === REFUSAL.PLAY_STOPPED);
  ok("PLAY_STOPPED: a penalty", asked(penalty({ runs: 5, toBattingTeam: true, reason: "helmet_struck" })) === REFUSAL.PLAY_STOPPED);
  const inn = view().innings[0];
  ok("PLAY_STOPPED: a seal for any reason but a termination", asked(sealInnings(inn, "declared")) === REFUSAL.PLAY_STOPPED);
  ok("...a termination (sealed abandoned) is the umpires' call, and accepted", asked(sealInnings(inn, "abandoned")) === null);
  ok("REVISION_BELOW_BOWLED: 1 over when 1.3 are bowled (the over in progress needs 2)", asked(revision({ overs: 1 })) === REFUSAL.REVISION_BELOW_BOWLED);
  ok("...2 overs is accepted", asked(revision({ overs: 2 })) === null);
  ok("...a raise is not refused (D3)", asked(revision({ overs: 7 })) === null);
  ok("PAR_WITHOUT_TARGET: a par for a first innings, which has no target", asked(revision({ par: 30 })) === REFUSAL.PAR_WITHOUT_TARGET);
  push(revision({ overs: 4, clientTs: T + 30 }));
  push(playResumed({ clientTs: T + 40 }));
  ok("the resumption accepted, play goes on: a ball", asked(ball({ type: BALL_TYPE.RUN, value: 1 })) === null);
  // Play out to the revised four overs, seal, and the stop is outside the innings.
  bowl(15);
  ok("balls past the revised allotment are refused already (INNINGS_OVER)", asked(ball({ type: BALL_TYPE.RUN, value: 1 })) === REFUSAL.INNINGS_OVER);
  ok("STOP_OUTSIDE_INNINGS: a stop in an innings the Laws have ended", asked(playStopped({})) === REFUSAL.STOP_OUTSIDE_INNINGS);
  push(sealInnings(view().innings[0]));
  ok("STOP_OUTSIDE_INNINGS: a resumption in a sealed innings", asked(playResumed({})) === REFUSAL.STOP_OUTSIDE_INNINGS);
  push({ ...inningsStart({ battingTeam: "Kearsney", bowlingTeam: "1XI", overs: 4, target: 25, clientTs: T + 80, squad: sq }), innings: 1 });
  ok("a par for the chase, which has a target, is accepted", asked(revision({ innings: 1, par: 20 })) === null);
  ok("...and a stop in the chase", asked(playStopped({ innings: 1 })) === null);
  ok("every refusal has words, and a likely cause or none, without throwing",
     ["play_stopped", "play_already_stopped", "play_not_stopped", "stop_outside_innings", "revision_below_bowled", "par_without_target"]
       .every((c) => typeof /** @type {any} */ (REFUSAL_TEXT)[c] === "string" && (() => { try { likelyCause(c, { inn: view().innings[0] }); return true; } catch { return false; } })()));
}

group("D2. Rain never revises a super over (design §5; db/71 merged)");
{
  /** @type {any[]} */
  const log = [inningsStart({ battingTeam: "1XI", bowlingTeam: "Kearsney", overs: 1, clientTs: T }),
               { ...inningsStart({ battingTeam: "Kearsney", bowlingTeam: "1XI", overs: 1, target: 7, clientTs: T + 1 }), innings: 1 },
               { ...inningsStart({ battingTeam: "Kearsney", bowlingTeam: "1XI", overs: 1, superOver: 1, clientTs: T + 2 }), innings: 2 }]
    .map((e, k) => ({ ...e, id: `so:${k}` }));
  const v = new MatchFold(log, { startsAt: RAIN_STARTS_AT }).view();
  ok("a par, a cut or a target in a super over is the super over's refusal, never the rain rule's: super_over_no_revision",
     [{ par: 5 }, { overs: 0 }, { target: 9 }].every((o) => lawsRefusal(v, { ...revision({ ...o, clientTs: T + 3 }), innings: 2 }) === REFUSAL.SUPER_OVER_NO_REVISION));
}

group("E. The words, by the frozen method");
{
  const below = RAIN_LOGS.find((l) => l.name.includes("below par"));
  const ump = RAIN_LOGS.find((l) => l.name.includes("under the umpires' revision"));
  const fold = (/** @type {any} */ x) => deriveMatch(x.log, { startsAt: RAIN_STARTS_AT, conditions: x.play ?? undefined, status: x.status, sides: RAIN_SIDES, names: RAIN_NAMES });
  ok("dls_standard says (DLS)", fold(below).result?.text === "Hilton 1XI won by 4 runs (DLS)");
  ok("umpires_revision says (revised target); the outcome and margin are the same",
     fold(ump).result?.text === "Hilton 1XI won by 4 runs (revised target)" && fold(ump).result?.marginValue === fold(below).result?.marginValue);
  ok("revisedTargetMethod(): no revision, no method", revisedTargetMethod(deriveMatch(RAIN_LOGS[RAIN_LOGS.length - 3].log).innings, { "target.method": "dls_standard" }) === null);
  ok("...and none for two innings a side", revisedTargetMethod(fold(below).innings, { "format.innings_per_side": 2 }) === null);
  // The SQL row's words: the chase's entry names the method (match_result_compute(), db/73).
  const row = { outcome: "home_win", margin_kind: "runs", margin: 4, decided_by: "play", winner_side: "home", winner_key: "1XI",
                play_outcome: "home_win", play_winner_side: "home", play_winner_key: "1XI", play_margin_kind: "runs", play_margin: 4,
                innings: [{ position: 0, revised_target: null }, { position: 1, revised_target: "dls_standard" }] };
  const rr = resultFromRow(row);
  ok("resultFromRow() reads the method off the chase's entry, and the words agree with the fold's",
     rr?.revisedTarget === "dls_standard" && resultWords(/** @type {any} */ (rr), { nameOf: () => "Hilton 1XI" }) === "Hilton 1XI won by 4 runs (DLS)");
  const tie = resultFromRow({ outcome: "tie", play_outcome: "tie", innings: [{}, { revised_target: "umpires_revision" }] });
  ok("a tie: Match tied (revised target)", resultWords(/** @type {any} */ (tie), {}) === "Match tied (revised target)");
  const nr = resultFromRow({ outcome: "no_result", play_outcome: "no_result", innings: [{}, { revised_target: "dls_standard" }] });
  ok("no result carries no suffix", resultWords(/** @type {any} */ (nr), {}) === "No result");
}

group("F. MatchFold.view() and deriveMatch() agree on the stop");
for (const x of RAIN_LOGS) {
  const a = deriveMatch(x.log, { startsAt: RAIN_STARTS_AT }).innings;
  const b = new MatchFold(x.log, { startsAt: RAIN_STARTS_AT }).view().innings;
  const s = (/** @type {any[]} */ l) => JSON.stringify(l.map((i) => [i.stopped, i.par, i.interruptions]));
  ok(`${x.name}: the same stops`, s(a) === s(b));
}

group("G. The commentary: the stop, the resumption, the par, the weather's ending, the result's suffix");
{
  const texts = (/** @type {any} */ x) => deriveCommentary(x.log, { ctx: { startsAt: RAIN_STARTS_AT, conditions: x.play ?? undefined } }).map((l) => l.text);
  const first = texts(RAIN_LOGS[0]);
  ok("a stop at 2.0 is told with the position and the score", first.includes("Rain stops play at 2.0, 1XI 12/0."), first.filter((t) => /stops|resumes/.test(t)));
  ok("...the resumption with the new allotment", first.includes("Play resumes: the innings is now 4 overs."));
  const below = texts(RAIN_LOGS.find((l) => l.name.includes("below par")));
  ok("the par is told, the weather ends the innings, and the result carries (DLS)",
     below.some((t) => t.includes("the umpires announce a par score of 18"))
     && below.some((t) => t.startsWith("Rain ends the innings at 14/1, after 1.3 overs."))
     && below.some((t) => t.endsWith("1XI win by 4 runs (DLS).")), below.slice(-3));
  const none = texts(RAIN_LOGS.find((l) => l.name.includes("with no par")));
  ok("a chase terminated with no par says no result, never a tie",
     none.some((t) => t.startsWith("Bad light ends the innings") && t.endsWith("No result.")) && !none.some((t) => t.includes("tied")), none.slice(-2));
  const mid = texts(RAIN_LOGS.find((l) => l.name.startsWith("two interruptions")));
  ok("a resumption under the same allotment is just that", mid.includes("Play resumes.") && mid.includes("A wet ground stops play at 2.0, 1XI 12/0."));
}

console.log(`\n${"─".repeat(52)}\nRAIN SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
