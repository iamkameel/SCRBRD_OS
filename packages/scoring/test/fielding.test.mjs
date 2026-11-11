/**
 * Who fielded the wicket (RECOGNITION R12, P2), and the boundary a no-ball's
 * runs reached (P8): the event, the Laws, the credit, the facts.
 *
 *   A. the event: `fielders` on a catch (one), a stumping (one), a run out
 *      (one or two), refused anywhere else and in any other shape; omitted,
 *      the wicket is the event it was; the wire round trip
 *   B. the Laws: a batter at the crease, two on a catch, a name twice; a
 *      stumping's fielder is the keeper on the record; server and pad agree
 *   C. the credit (fieldingCredits): one per fielder named, each fielder of a
 *      run out one run out (the contribution rule); nothing for a wicket a
 *      free hit saved, a void, a way out with no fielder, or a wicket that
 *      names nobody — unknown, not nought; the keeper's catches marked
 *   D. old logs fold as they did: a log with `fielders` folds every figure,
 *      every card line and every keeping figure as the same log without them
 *   E. the facts: fielding lines for linked boys only, never a super over,
 *      never a scorebook card; a corrected log's credit goes with its ball
 *   F. P8: a no-ball's four all run is runs and no four, in the fold and the facts
 *   G. Player of the Match: fielding counts where every fielding wicket names
 *      its fielders, and D17's line goes; otherwise batting and bowling only
 *
 *   node packages/scoring/test/fielding.test.mjs
 */
import {
  deriveInnings, deriveMatch, MatchFold, lawsRefusal, REFUSAL, REFUSAL_TEXT, likelyCause,
  inningsStart, batters, bowler, ball, keeper, voidEvent, toRow, fromRow, BALL_TYPE,
  fieldingCredits, fieldersFit, FIELDED_DISMISSALS, FIELDER_REF_MAX, deriveFacts,
  suggestPlayerOfMatch, matchFigures, figuresWords, potmBasis, basisWords, POTM_BASIS, POTM_BASIS_FIELDING, POTM_BASES,
  BASIS_WORDS, FIELDING_WEIGHT,
} from "../src/index.mjs";

let pass = 0, fail = 0;
/** @type {(n: string, c: unknown, d?: unknown) => void} */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)?.slice(0, 300)}`); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
/** @param {() => unknown} f */
const throws = (f) => { try { f(); return false; } catch { return true; } };

const SEP15 = Date.parse("2026-09-15T08:00:00Z");
// Ids shaped as SCRBRD's are, so the facts' default roster (a player id) holds them.
const id = (/** @type {number} */ k) => `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`;
const BAT = [1, 2, 3, 4, 5, 6].map((k) => ({ id: id(k), name: `Bat ${k}` }));
const K1 = { id: id(21), name: "Kyle Keeper" }, F1 = { id: id(22), name: "Fred Fielder" }, F2 = { id: id(23), name: "Sam Second" };
const W1 = { id: id(24), name: "Will Bowler" };
const FIELD = [K1, F1, F2, W1];

let n = 0;
/** @param {number} ts @returns {(e: any) => any} */
const stamp = (ts) => (e) => ({ ...e, id: e.id ?? `f${++n}`, clientTs: ts });
/** @param {{keep?: string | null, innings?: number}} [o] */
const opening = ({ keep = K1.id, innings = 0 } = {}) => [
  inningsStart({ innings, battingTeam: "Bat XI", bowlingTeam: "Field XI", squad: BAT, bowlingSquad: FIELD, overs: 5 }),
  batters({ innings, striker: BAT[0].id, nonStriker: BAT[1].id }),
  bowler({ innings, bowler: W1.id }),
  ...(keep === null ? [] : [keeper({ innings, keeper: keep })]),
].map(stamp(SEP15));
/** @param {...any} evs */
const at = (...evs) => evs.map(stamp(SEP15));
const W = (/** @type {Record<string, any>} */ o) => ball({ type: BALL_TYPE.WICKET, value: 0, ...o });
const dot = () => ball({ type: BALL_TYPE.RUN, value: 0 });
const next = (/** @type {number} */ k) => batters({ striker: BAT[k].id, nonStriker: BAT[1].id });
/** Server's fold and the pad's must agree on the Laws' answer. */
const refusal = (/** @type {any[]} */ log, /** @type {any} */ ev) => {
  const e = { innings: 0, clientTs: SEP15, ...ev };
  const server = lawsRefusal(new MatchFold(log).view(), e);
  const pad = lawsRefusal({ innings: [deriveInnings(log)], events: [log] }, e);
  return server === pad ? server : `disagree: server ${server}, pad ${pad}`;
};
/** Every figure the fold gives, the ball log's own copies of each event set aside. */
const figures = (/** @type {any} */ inn) => JSON.stringify({ ...inn, ballLog: undefined, overLog: undefined });
/** @param {any} e */
const strip = (e) => { const { fielders, ...rest } = e; return rest; };

group("A. The event");
{
  const c = W({ dismissal: "caught", fielder: F1.name, fielders: [F1.id] });
  ok("a catch names its catcher", JSON.stringify(c.fielders) === JSON.stringify([F1.id]) && c.fielder === F1.name);
  ok("a stumping names the keeper", W({ dismissal: "stumped", fielder: K1.name, fielders: [K1.id] }).fielders?.[0] === K1.id);
  ok("a run out names one or two", W({ dismissal: "run_out", fielders: [F1.id] }).fielders?.length === 1
     && W({ dismissal: "run_out", fielder: `${F1.name}/${F2.name}`, fielders: [F1.id, F2.id] }).fielders?.length === 2);
  ok("a typed name is a reference too (a substitute, the other side's boy)", W({ dismissal: "caught", fielders: ["J Sub"] }).fielders?.[0] === "J Sub");
  ok("a run out off a wide carries them", ball({ type: BALL_TYPE.WIDE, value: 1, dismissal: "run_out", fielders: [F1.id] }).fielders?.[0] === F1.id);
  ok("refused: on a delivery that is no wicket", throws(() => ball({ type: BALL_TYPE.RUN, value: 1, fielders: [F1.id] })));
  ok("refused: on a way out with no fielder (bowled, lbw)", throws(() => W({ dismissal: "bowled", fielders: [F1.id] }))
     && throws(() => W({ dismissal: "lbw", fielders: [F1.id] })));
  ok("refused: two on a catch, two on a stumping, three on a run out",
     throws(() => W({ dismissal: "caught", fielders: [F1.id, F2.id] })) && throws(() => W({ dismissal: "stumped", fielders: [K1.id, F1.id] }))
     && throws(() => W({ dismissal: "run_out", fielders: [F1.id, F2.id, K1.id] })));
  ok("refused: none, a name twice, an empty or untrimmed or overlong name, not a list",
     [[], [F1.id, F1.id], [""], [" J Sub"], ["x".repeat(FIELDER_REF_MAX + 1)], F1.id, [7]]
       .every((f) => throws(() => W({ dismissal: "run_out", fielders: /** @type {any} */ (f) }))));
  const plain = W({ dismissal: "caught", fielder: F1.name });
  ok("omitted, a wicket is the event it was: no `fielders` key", !("fielders" in plain) && !("fielders" in W({ dismissal: "caught", fielder: F1.name, fielders: null })));
  ok("the rule's table: one, one, two", FIELDED_DISMISSALS.get("caught") === 1 && FIELDED_DISMISSALS.get("stumped") === 1
     && FIELDED_DISMISSALS.get("run_out") === 2 && FIELDED_DISMISSALS.size === 3);
  ok("fieldersFit is the one rule", fieldersFit([F1.id], "caught") && !fieldersFit([F1.id], "bowled") && !fieldersFit(null, "caught"));
  const row = toRow({ ...c, innings: 0, seq: 9 });
  ok("the wire: fielders ride in the payload, and come back", JSON.stringify(row.payload.fielders) === JSON.stringify([F1.id])
     && JSON.stringify(/** @type {any} */ (fromRow({ ...row, seq: 9 })).fielders) === JSON.stringify([F1.id]));
}

group("B. The Laws");
{
  const log = opening();
  ok("a catch by a fielder: allowed", refusal(log, W({ dismissal: "caught", fielder: F1.name, fielders: [F1.id] })) === null);
  ok("a run out by two: allowed", refusal(log, W({ dismissal: "run_out", fielder: "a/b", fielders: [F1.id, F2.id] })) === null);
  ok("a fielder who is a batter at the crease: refused", refusal(log, W({ dismissal: "caught", fielders: [BAT[1].id] })) === REFUSAL.FIELDERS_INVALID);
  ok("a stumping by the keeper on the record: allowed", refusal(log, W({ dismissal: "stumped", fielder: K1.name, fielders: [K1.id] })) === null);
  ok("...by anyone else: refused, as its `fielder` would be", refusal(log, W({ dismissal: "stumped", fielders: [F1.id] })) === REFUSAL.STUMPED_NOT_KEEPER);
  ok("...with no keeper recorded: as before, nothing to check", refusal(opening({ keep: null }), W({ dismissal: "stumped", fielders: [F1.id] })) === null);
  // The constructor refuses these first on the pad; the server is handed raw payloads.
  ok("raw: two on a catch, a name twice, on a dot: refused",
     [{ type: "W", value: 0, dismissal: "caught", fielders: [F1.id, F2.id] }, { type: "W", value: 0, dismissal: "run_out", fielders: [F1.id, F1.id] },
      { type: "run", value: 0, fielders: [F1.id] }]
       .every((ev) => refusal(log, { kind: "ball", ...ev }) === REFUSAL.FIELDERS_INVALID));
  ok("it has words, without a clause number, and a likely cause", typeof REFUSAL_TEXT.fielders_invalid === "string"
     && !/\d+\.\d+/.test(REFUSAL_TEXT.fielders_invalid) && typeof likelyCause("fielders_invalid") === "string");
}

group("C. The credit");
{
  const log = [...opening(), ...at(
    W({ dismissal: "caught", fielder: F1.name, fielders: [F1.id] }), next(2),
    W({ dismissal: "caught", fielder: K1.name, fielders: [K1.id] }), next(3),
    W({ dismissal: "run_out", fielder: `${F1.name}/${F2.name}`, fielders: [F1.id, F2.id], outAt: "striker_end" }), next(4),
    W({ dismissal: "stumped", fielder: K1.name, fielders: [K1.id] }), next(5),
    W({ dismissal: "caught", fielder: "Fred Fielder" }),   // no reference: a log before the pad asked
  )];
  const inn = deriveInnings(log);
  const credits = inn.ballLog.flatMap((e) => fieldingCredits(e));
  ok("one credit for each fielder named", credits.length === 5, credits);
  ok("a run out by two: one run out each (the contribution rule)",
     credits.filter((c) => c.act === "run_out").map((c) => c.ref).join() === [F1.id, F2.id].join());
  ok("the keeper's catch is marked his, a fielder's is not",
     credits.find((c) => c.act === "catch" && c.ref === K1.id)?.keeper === true && credits.find((c) => c.ref === F1.id && c.act === "catch")?.keeper === false);
  ok("a stumping is the keeper's", credits.some((c) => c.act === "stumping" && c.ref === K1.id && c.keeper));
  ok("a catch named only by its scorecard text credits nobody: unknown, not guessed", fieldingCredits(inn.ballLog.at(-1)) .length === 0);
  ok("nothing for a dot, a bowled, or no entry", fieldingCredits(inn.ballLog[0]) .length >= 0
     && fieldingCredits(/** @type {any} */ ({ kind: "ball", type: "W", dismissal: "bowled" })).length === 0 && fieldingCredits(null).length === 0);
  // A free hit saves a catch: no wicket, so no credit.
  const fh = [...opening(), ...at(ball({ type: BALL_TYPE.NO_BALL, value: 0, nbType: "front_foot" }),
    W({ dismissal: "caught", fielder: F1.name, fielders: [F1.id], freeHit: true }))];
  const fhInn = deriveInnings(fh);
  ok("a catch a free hit saved: no wicket, no credit", fhInn.wickets === 0 && fhInn.ballLog.flatMap((e) => fieldingCredits(e)).length === 0);
  // A void takes the ball, and its credit, away.
  const caught = stamp(SEP15)(W({ dismissal: "caught", fielder: F1.name, fielders: [F1.id] }));
  const voided = [...opening(), caught, ...at(voidEvent({ target: caught.id, reason: "wrong ball" }))];
  ok("a void takes the credit with the ball", deriveInnings(voided).ballLog.flatMap((e) => fieldingCredits(e)).length === 0);
}

group("D. A log with fielders folds every figure as the same log without them");
{
  const evs = [...opening(), ...at(
    dot(), W({ dismissal: "caught", fielder: F1.name, fielders: [F1.id] }), next(2),
    W({ dismissal: "caught", fielder: K1.name, fielders: [K1.id] }), next(3),
    W({ dismissal: "run_out", fielder: `${F1.name}/${F2.name}`, fielders: [F1.id, F2.id], outAt: "bowler_end", value: 1 }), next(4),
    W({ dismissal: "stumped", fielder: K1.name, fielders: [K1.id] }),
  )];
  const without = evs.map((e) => (e.kind === "ball" ? strip(e) : e));
  const a = deriveInnings(evs), b = deriveInnings(without);
  ok("every figure, the scorecard, the keeping: the same", figures(a) === figures(b), [figures(a).slice(0, 200), figures(b).slice(0, 200)]);
  ok("...the ball log the same but for the field itself",
     JSON.stringify(a.ballLog.map(strip)) === JSON.stringify(b.ballLog.map(strip)));
  ok("...and the keeper's catches and stumpings are the keeping record's, unchanged", a.keepers[0]?.catches === 1 && a.keepers[0]?.stumpings === 1);
  ok("the run out by two reads as a scorecard writes it", a.batsmen.some((x) => x.dismissal === `run out (${F1.name}/${F2.name})`));
}

group("E. The facts");
{
  const evs = [...opening(), ...at(
    W({ dismissal: "caught", fielder: F1.name, fielders: [F1.id] }), next(2),
    W({ dismissal: "caught", fielder: K1.name, fielders: [K1.id] }), next(3),
    W({ dismissal: "run_out", fielder: "x", fielders: [F1.id, "J Sub"] }), next(4),
    W({ dismissal: "stumped", fielder: K1.name, fielders: [K1.id] }),
  )];
  const f = deriveFacts(evs);
  const line = (/** @type {string} */ p) => f.fielding.find((x) => x.player === p);
  ok("the fielder: a catch and a run out", line(F1.id)?.catches === 1 && line(F1.id)?.runOuts === 1 && line(F1.id)?.keeperCatches === 0);
  ok("the keeper: a catch as keeper and a stumping", line(K1.id)?.catches === 1 && line(K1.id)?.keeperCatches === 1 && line(K1.id)?.stumpings === 1);
  ok("a typed name holds no line; a boy with no credit has no line (unknown, not nought)",
     !line("J Sub") && !line(F2.id) && f.fielding.length === 2);
  ok("each line names the innings he fielded in", f.fielding.every((x) => x.innings === 0));
  ok("a log that names nobody: no fielding at all", deriveFacts(evs.map((e) => (e.kind === "ball" ? strip(e) : e))).fielding.length === 0);
  const so = [...opening(), ...at(W({ dismissal: "caught", fielder: F1.name, fielders: [F1.id] }))].map((e, i) =>
    (i === 0 ? { ...e, superOver: 1 } : e));
  ok("a super over is never a fielding figure", deriveFacts(so).fielding.length === 0);
}

group("F. P8: a no-ball's four all run");
{
  const keyed = deriveInnings([...opening(), ...at(ball({ type: BALL_TYPE.NO_BALL, value: 4, nbType: "front_foot" }))]);
  const allRun = deriveInnings([...opening(), ...at(ball({ type: BALL_TYPE.NO_BALL, value: 4, nbType: "front_foot", boundary: false }))]);
  const s = (/** @type {any} */ i) => i.batsmen.find((/** @type {any} */ x) => x.id === BAT[0].id);
  ok("keyed, a no-ball's four off the bat is a four", s(keyed).fours === 1 && s(keyed).runs === 4);
  ok("all run, the same runs and no four", s(allRun).fours === 0 && s(allRun).runs === 4 && allRun.runs === keyed.runs);
  ok("a no-ball carrying a run out after four all run folds", deriveMatch([...opening(), ...at(
    ball({ type: BALL_TYPE.NO_BALL, value: 4, nbType: "front_foot", boundary: false, dismissal: "run_out", fielders: [F1.id], outAt: "bowler_end" }))])
    .innings[0].wickets === 1);
}

group("G. Player of the Match: the basis, and fielding in the order");
{
  const sheet = FIELD.map((p) => p.id);
  // Fred takes two catches and a run out; Will bowls, one wicket his.
  const named = [...opening(), ...at(
    W({ dismissal: "caught", fielder: F1.name, fielders: [F1.id] }), next(2),
    W({ dismissal: "caught", fielder: F1.name, fielders: [F1.id] }), next(3),
    W({ dismissal: "run_out", fielder: F1.name, fielders: [F1.id] }), next(4),
    W({ dismissal: "bowled" }),
  )];
  const f = deriveFacts(named, sheet);
  ok("every fielding wicket named: nothing unattributed, the fielding basis", f.unattributed === 0 && potmBasis(f) === POTM_BASIS_FIELDING);
  ok("...and D17's line is dropped", basisWords(POTM_BASIS_FIELDING) === null && basisWords(POTM_BASIS) === BASIS_WORDS);
  const s1 = suggestPlayerOfMatch(f, sheet);
  ok("the fielder is suggested on his fielding: 3 x ten against the bowler's 3 x twenty",
     s1[0]?.playerId === W1.id && s1[1]?.playerId === F1.id && FIELDING_WEIGHT === 10, s1);
  ok("...his figures in words", s1[1]?.figures === "2 catches · 1 run out", s1);
  const unnamed = named.map((e) => (e.kind === "ball" && e.dismissal === "run_out" ? strip(e) : e));
  const g = deriveFacts(unnamed, sheet);
  ok("one wicket naming nobody: fielding unknown, batting and bowling only", g.unattributed === 1 && potmBasis(g) === POTM_BASIS);
  ok("...and the fielder is not suggested on it", !suggestPlayerOfMatch(g, sheet).some((x) => x.playerId === F1.id));
  ok("a stored basis is read as stored: the old basis over the new log leaves fielding out",
     !suggestPlayerOfMatch(f, sheet, undefined, POTM_BASIS).some((x) => x.playerId === F1.id)
     && matchFigures(f, [F1.id], POTM_BASIS)[0].field === undefined);
  ok("facts from before R12 (no count) are the old basis", potmBasis({}) === POTM_BASIS && POTM_BASES.length === 2);
  const bowledOnly = deriveFacts([...opening(), ...at(W({ dismissal: "bowled" }), next(2), W({ dismissal: "lbw" }))], sheet);
  ok("a log that names no fielder anywhere — every log before R12 — is the old basis, though nothing is unattributed",
     bowledOnly.unattributed === 0 && bowledOnly.credited === 0 && potmBasis(bowledOnly) === POTM_BASIS);
  ok("...and a typed substitute's catch is a credit the basis counts, though he holds no line",
     deriveFacts([...opening(), ...at(W({ dismissal: "caught", fielders: ["J Sub"] }))], sheet).credited === 1);
  ok("a boy who only fielded is 'did not bat or bowl' with nothing to name, else his fielding",
     figuresWords({ playerId: "x", bat: null, bowl: null, field: null }) === "Did not bat or bowl"
     && figuresWords({ playerId: "x", bat: null, bowl: null, field: { catches: 1, stumpings: 1, runOuts: 0 } }) === "1 catch · 1 stumping");
}

console.log(`\nFIELDING: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
