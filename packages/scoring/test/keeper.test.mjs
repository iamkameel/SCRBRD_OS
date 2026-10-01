/**
 * The wicket-keeper (SCRBRD-126): an event, the fold, the Laws, the words.
 *
 *   A. the event: its shape, the wire round trip (the keeper rides in the
 *      payload), and a log with no keeper event folding exactly as before —
 *      and a log WITH keeper events folding every other figure as without
 *   B. the fold: the keeper stamped on each delivery from the point he is
 *      named, a change mid-over (no change of bowler), his catches and
 *      stumpings — only wickets that stand, a catch by his reference or his
 *      name, a stumping with no fielder named his — and the card's line
 *   C. the Laws (Law 39): a stumping credited to anyone but the keeper at
 *      that ball is refused while one is recorded, asked of the server's
 *      fold and the pad's; with none recorded, as before; a keeper event's
 *      own refusals
 *   D. the words: the commentary names him, the refusal says why without a
 *      clause number, the held list and the cause
 *
 * Every event is dated 15 September 2026 (the 3rd Edition) or 2 October (the
 * 4th), never the clock: the stumping rule is the same in both.
 *
 *   node packages/scoring/test/keeper.test.mjs
 */
import {
  deriveInnings, MatchFold, lawsRefusal, REFUSAL, REFUSAL_TEXT, likelyCause, deriveCommentary, COMMENTARY_KIND,
  inningsStart, batters, bowler, ball, keeper, voidEvent, inningsSummary, toRow, fromRow, KIND, BALL_TYPE,
  isKeeperRef, keeperOf,
} from "../src/index.mjs";
import { baseCard } from "./scorebook-cards.mjs";

let pass = 0, fail = 0;
/** @type {(n: string, c: unknown, d?: unknown) => void} */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)?.slice(0, 300)}`); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const SEP15 = Date.parse("2026-09-15T08:00:00Z");
const OCT2 = Date.parse("2026-10-02T08:00:00Z");
const BAT = ["b1", "b2", "b3", "b4", "b5", "b6"].map((id) => ({ id, name: id.toUpperCase() }));
// The fielding side: ids with names, as a real squad is.
const FIELD = [["k1", "Kyle Keeper"], ["k2", "Sam Second"], ["f1", "Fred Fielder"], ["w1", "Will Bowler"], ["w2", "Wes Bowler"]]
  .map(([id, name]) => ({ id, name }));

let n = 0;
/** @param {number} ts @returns {(e: any) => any} */
const stamp = (ts) => (e) => ({ ...e, id: e.id ?? `k${++n}`, clientTs: ts });
/**
 * An innings: its start, the openers, the bowler — and, unless `keep` is
 * null, the keeper named with the first bowler, as the pad asks.
 * @param {{ts?: number, keep?: string | null, innings?: number}} [o]
 */
const opening = ({ ts = SEP15, keep = "k1", innings = 0 } = {}) => [
  inningsStart({ innings, battingTeam: "Bat XI", bowlingTeam: "Field XI", squad: BAT, bowlingSquad: FIELD, overs: 5 }),
  batters({ innings, striker: "b1", nonStriker: "b2" }),
  bowler({ innings, bowler: "w1" }),
  ...(keep === null ? [] : [keeper({ innings, keeper: keep })]),
].map(stamp(ts));
/** @param {number} ts @param {...any} evs */
const at = (ts, ...evs) => evs.map(stamp(ts));
const W = (/** @type {Record<string, any>} */ o) => ball({ type: BALL_TYPE.WICKET, value: 0, ...o });
const dot = () => ball({ type: BALL_TYPE.RUN, value: 0 });

/** Ask the Laws of the next event, of the server's fold and the pad's: they must agree. */
const refusal = (/** @type {any[]} */ log, /** @type {any} */ ev) => {
  const e = { innings: 0, clientTs: log[0]?.clientTs ?? SEP15, ...ev };
  const server = lawsRefusal(new MatchFold(log).view(), e);
  const byInnings = /** @type {any[][]} */ ([]);
  for (const x of log) (byInnings[x.innings ?? 0] ??= []).push(x);
  const pad = lawsRefusal({ innings: byInnings.map((evs) => deriveInnings(evs)), events: byInnings }, e);
  return server === pad ? server : `disagree: server ${server}, pad ${pad}`;
};

/** The fold without the keeper's own fields: what it was before SCRBRD-126. */
const withoutKeeper = (/** @type {any} */ inn) => {
  const { keeper: _k, keepers: _ks, ballLog, overLog, ...rest } = inn;
  const strip = (/** @type {any} */ b) => { const { keeperId: _x, ...r } = b; return r; };
  return JSON.stringify({ ...rest, ballLog: ballLog.map(strip), overLog: overLog.map((/** @type {any} */ o) => ({ ...o, balls: o.balls.map(strip) })) });
};

// ── A. The event ───────────────────────────────────────────────
group("A. The event: a kind of its own, the wire, old logs");
{
  const e = keeper({ innings: 1, keeper: "k1", clientTs: SEP15, id: "x1" });
  ok("keeper() builds {kind, innings, clientTs, id, keeper}", JSON.stringify(e) === JSON.stringify({ kind: "keeper", innings: 1, clientTs: SEP15, id: "x1", keeper: "k1" }), e);
  ok("KIND.KEEPER is \"keeper\"", KIND.KEEPER === "keeper");
  ok("a keeper not given is null", keeper({ clientTs: SEP15 }).keeper === null);
  const uuid = "aaaaaaaa-0000-4000-8000-000000000009";
  const row = toRow(keeper({ keeper: uuid, clientTs: SEP15 }));
  ok("toRow: the keeper rides in the payload, even an id (no column of his own)",
     row.kind === "keeper" && row.payload.keeper === uuid && row.bowler_id === null && row.striker_id === null, row);
  const back = fromRow({ ...row, seq: 7, idempotency_key: "x2" });
  ok("fromRow gives him back", back.kind === "keeper" && back.keeper === uuid && back.seq === 7 && back.id === "x2", back);

  // A log with no keeper event: nothing new anywhere in the fold.
  const old = [...opening({ keep: null }), ...at(SEP15, dot(), ball({ type: BALL_TYPE.RUN, value: 4 }),
    W({ dismissal: "stumped", fielder: "Fred Fielder" }), batters({ striker: "b3" }), W({ dismissal: "caught", fielder: "Kyle Keeper" }))];
  const inn = deriveInnings(old);
  ok("no keeper event: keeper null, keepers empty", inn.keeper === null && inn.keepers.length === 0);
  ok("...and no delivery carries a keeperId key", inn.ballLog.every((b) => !("keeperId" in b)));
  ok("...and the card reads as it always did", inn.batsmen.find((b) => b.id === "b1")?.dismissal === "st Fred Fielder b Will Bowler",
     inn.batsmen.map((b) => b.dismissal));

  // The same deliveries with keeper events among them: every other figure as without.
  const withK = [...opening(), ...at(SEP15, dot(), ball({ type: BALL_TYPE.RUN, value: 4 }), keeper({ keeper: "k2" }),
    W({ dismissal: "stumped", fielder: "Sam Second" }), batters({ striker: "b3" }), W({ dismissal: "caught", fielder: "Kyle Keeper" }))];
  const noK = withK.filter((e) => e.kind !== "keeper").map((e) => (e.kind === "ball" && e.dismissal === "stumped" ? { ...e, fielder: "Sam Second" } : e));
  ok("with keeper events, every figure but the keeper's own is the fold without them",
     withoutKeeper(deriveInnings(withK)) === withoutKeeper(deriveInnings(noK)));
  const mf = new MatchFold(withK).view().innings[0];
  ok("MatchFold.view() and deriveInnings() agree on the keeper",
     mf.keeper === "k2" && JSON.stringify(mf.keepers) === JSON.stringify(deriveInnings(withK).keepers), mf.keepers);
}

// ── B. The fold ────────────────────────────────────────────────
group("B. The fold: the keeper at each ball, a change mid-over, his dismissals");
{
  const log = [...opening(), ...at(SEP15,
    dot(),                                                       // 0.1  k1
    W({ dismissal: "caught", fielder: "Kyle Keeper" }),          // 0.2  k1 catch, by name
    batters({ striker: "b3" }),
    keeper({ keeper: "k2" }),                                    // mid-over: the gloves to k2
    W({ dismissal: "stumped" }),                                 // 0.3  k2 stumping, no fielder named
    batters({ striker: "b4" }),
    W({ dismissal: "caught", fielder: "Kyle Keeper" }),          // 0.4  a catch by k1 — no longer keeping
    batters({ striker: "b5" }),
    W({ dismissal: "caught", fielder: "k2" }),                   // 0.5  k2 catch, by reference
    batters({ striker: "b6" }),
    W({ dismissal: "run_out", fielder: "Sam Second" }),          // 0.6  a run out: not a keeper dismissal
  )];
  const inn = deriveInnings(log);
  ok("each delivery carries the keeper when it was bowled",
     JSON.stringify(inn.ballLog.map((b) => b.keeperId)) === JSON.stringify(["k1", "k1", "k2", "k2", "k2", "k2"]), inn.ballLog.map((b) => b.keeperId));
  ok("a keeper change mid-over is no change of bowler", inn.bowlerChanges.length === 0 && inn.ballLog.every((b) => b.bowlerId === "w1"));
  ok("the keeper now is k2, and he stays on at the over's end (unlike the bowler)", inn.keeper === "k2" && inn.bowler === null);
  ok("keepers: both, in the order named, with their names",
     JSON.stringify(inn.keepers.map((k) => [k.id, k.name])) === JSON.stringify([["k1", "Kyle Keeper"], ["k2", "Sam Second"]]), inn.keepers);
  const k1 = inn.keepers[0], k2 = inn.keepers[1];
  ok("k1: one catch (by his name), no stumping; his catch after the change is not as keeper", k1.catches === 1 && k1.stumpings === 0, k1);
  ok("k2: one stumping (no fielder named) and one catch (by reference)", k2.catches === 1 && k2.stumpings === 1, k2);
  ok("the card: a stumping with no fielder named is the keeper's", inn.batsmen.find((b) => b.id === "b3")?.dismissal === "st Sam Second b Will Bowler",
     inn.batsmen.map((b) => b.dismissal));
  ok("keeperOf(): the keeper and his name", JSON.stringify(keeperOf(inn)) === JSON.stringify({ id: "k2", name: "Sam Second" }));
  ok("isKeeperRef(): by reference or name, never with no keeper or no fielder",
     isKeeperRef("k2", "Sam Second", "k2") && isKeeperRef("k2", "Sam Second", "Sam Second") && !isKeeperRef("k2", "Sam Second", "Kyle Keeper")
     && !isKeeperRef(null, null, "k2") && !isKeeperRef("k2", "Sam Second", "") && !isKeeperRef("k2", "Sam Second", null));

  // A free hit saves a catch and a stumping alike: neither is the keeper's.
  const fh = [...opening(), ...at(SEP15, ball({ type: BALL_TYPE.NO_BALL, value: 0 }), W({ dismissal: "stumped" }),
    ball({ type: BALL_TYPE.NO_BALL, value: 0 }), W({ dismissal: "caught", fielder: "k1" }))];
  const f = deriveInnings(fh);
  ok("on a free hit: no wicket, and nothing to the keeper", f.wickets === 0 && f.keepers[0].catches === 0 && f.keepers[0].stumpings === 0, f.keepers);

  // A typed keeper (an opposition with no roster): his reference is his name.
  const typed = [...opening({ keep: "T Typedkeeper" }), ...at(SEP15, W({ dismissal: "caught", fielder: "T Typedkeeper" }))];
  const t = deriveInnings(typed);
  ok("a typed keeper: his name is his reference, and his catch is his",
     t.keepers[0].id === "T Typedkeeper" && t.keepers[0].name === "T Typedkeeper" && t.keepers[0].catches === 1, t.keepers);

  // Undone: a voided keeper event never happened.
  const v = [...opening(), ...at(SEP15, keeper({ keeper: "k2", id: "kk" }), voidEvent({ target: "kk" }), W({ dismissal: "stumped" }))];
  const vi = deriveInnings(v);
  ok("a voided keeper change: k1 kept on, and the stumping is his", vi.keeper === "k1" && vi.keepers.length === 1 && vi.keepers[0].stumpings === 1, vi.keepers);

  // Named again: the same line, not a second.
  const again = [...opening(), ...at(SEP15, keeper({ keeper: "k2" }), keeper({ keeper: "k1" }), W({ dismissal: "stumped" }))];
  const ag = deriveInnings(again);
  ok("k1, k2, k1 again: two lines, the stumping k1's", ag.keepers.length === 2 && ag.keepers[0].stumpings === 1 && ag.keepers[1].stumpings === 0, ag.keepers);

  // An innings from a scorebook knows no keeper.
  const card = baseCard(BAT.map((b) => b.id));
  const sum = deriveInnings([inningsStart({ battingTeam: "Bat XI", bowlingTeam: "Field XI", overs: 20, clientTs: SEP15 }),
    inningsSummary({ card, clientTs: SEP15 })]);
  ok("a summarised innings: no keeper", sum.summarised != null && sum.keeper === null && sum.keepers.length === 0);
}

// ── C. The Laws ────────────────────────────────────────────────
group("C. The Laws: a stumping is the keeper's (Law 39)");
for (const ts of [SEP15, OCT2]) {
  const ed = ts === SEP15 ? "3rd Edition" : "4th Edition";
  const log = opening({ ts });
  const st = (/** @type {any} */ fielder) => W({ dismissal: "stumped", ...(fielder === undefined ? {} : { fielder }), clientTs: ts });
  ok(`${ed}: stumped, credited to another fielder while k1 keeps — refused`, refusal(log, st("Fred Fielder")) === REFUSAL.STUMPED_NOT_KEEPER, refusal(log, st("Fred Fielder")));
  ok(`${ed}: ...by another fielder's reference — refused`, refusal(log, st("f1")) === REFUSAL.STUMPED_NOT_KEEPER);
  ok(`${ed}: ...spelt "st" — refused`, refusal(log, { ...st("Fred Fielder"), dismissal: "st" }) === REFUSAL.STUMPED_NOT_KEEPER);
  ok(`${ed}: stumped by the keeper's reference — taken`, refusal(log, st("k1")) === null);
  ok(`${ed}: stumped by the keeper's name — taken`, refusal(log, st("Kyle Keeper")) === null);
  ok(`${ed}: stumped with no fielder named — taken (the fold gives it to the keeper)`, refusal(log, st(undefined)) === null && refusal(log, st(null)) === null);
  const none = opening({ ts, keep: null });
  ok(`${ed}: with no keeper recorded, a stumping by anyone is taken, as before`, refusal(none, st("Fred Fielder")) === null);
  ok(`${ed}: a catch by anyone is taken, keeper or not`, refusal(log, W({ dismissal: "caught", fielder: "Fred Fielder", clientTs: ts })) === null);
  const changed = [...log, ...at(ts, keeper({ keeper: "k2" }))];
  ok(`${ed}: after the gloves change hands, the old keeper's stumping is refused`, refusal(changed, st("Kyle Keeper")) === REFUSAL.STUMPED_NOT_KEEPER);
  ok(`${ed}: ...and the new keeper's taken`, refusal(changed, st("Sam Second")) === null && refusal(changed, st("k2")) === null);
  // A wide carrying a stumping's method is not a wicket in this model (a
  // wicket is its own type, W); it is taken as it always was.
  ok(`${ed}: a wide with "stumped" on it is not refused`, refusal(log, ball({ type: BALL_TYPE.WIDE, value: 0, dismissal: "stumped", fielder: "Fred Fielder", clientTs: ts })) === null);
}
{
  // The keeper event's own answers.
  ok("a keeper with no innings started — no_innings", refusal([], keeper({ keeper: "k1", clientTs: SEP15 })) === REFUSAL.NO_INNINGS);
  ok("a keeper at the start, mid-over, between overs — taken",
     refusal(opening({ keep: null }), keeper({ keeper: "k1" })) === null
     && refusal([...opening(), ...at(SEP15, dot())], keeper({ keeper: "k2" })) === null);
  // Play has moved on to the second innings: the first takes no keeper.
  const two = [...opening(), ...at(SEP15, ...Array.from({ length: 30 }, dot)),
    ...opening({ innings: 1 }), stamp(SEP15)(ball({ innings: 1, type: BALL_TYPE.RUN, value: 1 }))];
  ok("a keeper for an innings play has moved on from — later_innings_started", refusal(two, keeper({ innings: 0, keeper: "k2" })) === REFUSAL.LATER_INNINGS_STARTED);
  // A paper scorebook's innings takes nothing from the pad, a keeper included;
  // and a keeper makes an innings one scored live, which a book cannot replace.
  const summarised = [stamp(SEP15)(inningsStart({ battingTeam: "Bat XI", bowlingTeam: "Field XI", overs: 20 })), stamp(SEP15)(inningsSummary({ card: baseCard(BAT.map((b) => b.id)) }))];
  ok("a keeper in an innings from a scorebook — summarised_innings", refusal(summarised, keeper({ keeper: "k1" })) === REFUSAL.SUMMARISED_INNINGS);
  const keptOnly = [stamp(SEP15)(inningsStart({ battingTeam: "Bat XI", bowlingTeam: "Field XI", overs: 20 })), stamp(SEP15)(keeper({ keeper: "k1" }))];
  ok("a scorebook summary of an innings with a keeper named on the pad — live_innings",
     refusal(keptOnly, inningsSummary({ card: baseCard(BAT.map((b) => b.id)) })) === REFUSAL.LIVE_INNINGS);
}

// ── D. The words ───────────────────────────────────────────────
group("D. The words: the refusal, its cause, the commentary");
{
  ok("REFUSAL_TEXT says it, with no Law clause number", typeof REFUSAL_TEXT.stumped_not_keeper === "string"
     && /keeper/.test(REFUSAL_TEXT.stumped_not_keeper) && !/\d/.test(REFUSAL_TEXT.stumped_not_keeper));
  const cause = likelyCause(REFUSAL.STUMPED_NOT_KEEPER, {});
  ok("likelyCause() says what to do, naming nobody", typeof cause === "string" && /keeper/.test(cause) && !/\d/.test(/** @type {string} */ (cause)), cause);

  const NAMES = /** @type {Record<string, string>} */ ({ b1: "B One", b2: "B Two", b3: "B Three", b4: "B Four", w1: "W Bowls", k1: "K Gloves", k2: "S Spare",
    "Kyle Keeper": "K Gloves", "Fred Fielder": "F Field" });
  const nameOf = (/** @type {string} */ r) => NAMES[r] ?? null;
  const log = [...opening(), ...at(SEP15,
    W({ dismissal: "caught", fielder: "Kyle Keeper" }), batters({ striker: "b3" }),
    keeper({ keeper: "k2" }),
    W({ dismissal: "stumped" }), batters({ striker: "b4" }),
    W({ dismissal: "caught", fielder: "Fred Fielder" }))];
  const lines = deriveCommentary(log, { nameOf });
  const keep = lines.filter((l) => l.kind === COMMENTARY_KIND.KEEPER).map((l) => l.text);
  ok("the keeper named at the start, by his name", /^K Gloves (keeps wicket|has the gloves) for Field XI\.$/.test(keep[0] ?? ""), keep);
  ok("the gloves changing hands", keep[1] === "S Spare takes the gloves from K Gloves.", keep);
  const wk = lines.filter((l) => l.kind === COMMENTARY_KIND.WICKET).map((l) => l.text);
  ok("a catch by the keeper is caught behind, by name", /caught behind by K Gloves/.test(wk[0] ?? ""), wk[0]);
  ok("a stumping with no fielder named names the keeper at the ball", /stumped by S Spare/.test(wk[1] ?? ""), wk[1]);
  ok("a catch by another fielder is as it was", /caught by F Field/.test(wk[2] ?? "") && !/behind/.test(wk[2] ?? ""), wk[2]);
  // Named by nobody (a public page): role words, and no first line at all.
  const anon = deriveCommentary(log, {});
  const anonKeep = anon.filter((l) => l.kind === COMMENTARY_KIND.KEEPER).map((l) => l.text);
  ok("unnamed: no first keeper line, the change in role words", anonKeep.length === 1 && anonKeep[0] === "The gloves change hands: a new wicket-keeper.", anonKeep);
  ok("unnamed: a stumping is by the keeper", anon.some((l) => /stumped by the keeper/.test(l.text)));
  // Named again before a ball: one line, the earlier goes.
  const redo = [...opening({ keep: null }), ...at(SEP15, keeper({ keeper: "k2" }), keeper({ keeper: "k1" }), dot())];
  const rk = deriveCommentary(redo, { nameOf }).filter((l) => l.kind === COMMENTARY_KIND.KEEPER).map((l) => l.text);
  ok("the scorer changed his mind before a ball: one line, for the keeper named last", rk.length === 1 && /^K Gloves /.test(rk[0]), rk);
  // A log without a keeper event: no keeper line, no "behind".
  const plain = deriveCommentary(log.filter((e) => e.kind !== "keeper"), { nameOf });
  ok("no keeper event: no keeper line, and the catch is \"caught by\"",
     !plain.some((l) => l.kind === COMMENTARY_KIND.KEEPER) && plain.some((l) => /caught by K Gloves/.test(l.text)) && !plain.some((l) => /behind/.test(l.text)));
}

// ── E. db/99 §46's log ─────────────────────────────────────────
// The fixture _seed_68() writes, folded here: §46 asserts SQL reads these
// figures, so SQL and the fold agree on it by these two files together
// (and on generated logs by tools/smoke-fold-figures.mjs).
group("E. db/99 §46's log: what the fold says SQL must read");
{
  const K1 = "aaaaaaaa-0000-0000-0000-000000000002", K2 = "aaaaaaaa-0000-0000-0000-000000000001";
  const F1 = "aaaaaaaa-0000-0000-0000-000000000005", BW = "aaaaaaaa-0000-0000-0000-000000000003";
  const B2 = "aaaaaaaa-0000-0000-0000-000000000004";
  const squad = [{ id: K1, name: "V68 Two" }, { id: K2, name: "V68 One" }, { id: F1, name: "V68 Five" }];
  /** @type {[number, string, Record<string, unknown>][]} */
  const rows = [
    [1, "innings_start", { battingTeam: "Verify 068", bowlingTeam: "Hilton 1XI", squad: [], bowlingSquad: squad }],
    [2, "keeper", { keeper: K1 }],
    [3, "ball", { type: "W", value: 0, dismissal: "caught", fielder: "V68 Two", striker: "Opp A" }],
    [4, "ball", { type: "Nb", value: 1, striker: "Opp B" }],
    [5, "ball", { type: "W", value: 0, dismissal: "stumped", striker: "Opp B" }],
    [6, "keeper", { keeper: K2 }],
    [7, "ball", { type: "W", value: 0, dismissal: "stumped", striker: "Opp B" }],
    [8, "ball", { type: "W", value: 0, dismissal: "caught", fielder: K2, striker: "Opp C" }],
    [9, "ball", { type: "W", value: 0, dismissal: "caught", fielder: "V68 Two", striker: "Opp D" }],
    [10, "ball", { type: "W", value: 1, dismissal: "run_out", fielder: "V68 One", striker: "Opp E" }],
    [11, "keeper", { keeper: F1 }],
    [12, "void", { target: "v68:11" }],
    [13, "ball", { type: "W", value: 0, dismissal: "stumped", fielder: "V68 One", striker: "Opp F" }],
  ];
  // As the database holds them: the bowler on each delivery (…03 the first
  // over, …04 the second).
  const log = rows.map(([seq, kind, p]) => /** @type {import("../src/events.mjs").LogEvent} */ (/** @type {unknown} */ ({
    kind, innings: 0, seq, id: `v68:${seq}`, clientTs: SEP15, ...(kind === "ball" ? { bowler: seq === 13 ? B2 : BW } : {}), ...p })));
  // The fold places the bowler from `bowler` events, which SQL's figures
  // do not read (they read the bowler stamped on each delivery): the pad
  // records both, so they are added here where the pad would have them.
  const bowlerEv = (/** @type {string} */ id, /** @type {string} */ b) => bowler({ innings: 0, id, clientTs: SEP15, bowler: b });
  const withBowler = [log[0], log[1], bowlerEv("v68:b1", BW), ...log.slice(2, 12), bowlerEv("v68:b2", B2), log[12]];
  const inn = deriveInnings(withBowler);
  const byId = Object.fromEntries(inn.keepers.map((k) => [k.id, [1, 1, k.catches, k.stumpings].join(",")]));
  ok("§46: …02 kept, one catch; …01 kept, one catch and two stumpings; …05 never kept (undone)",
     byId[K1] === "1,1,1,0" && byId[K2] === "1,1,1,2" && !(F1 in byId), byId);
  const seqOf = new Map(inn.ballLog.map((b) => [b, b.seq]));
  const keeperWickets = inn.ballLog.filter((b) => b.type === "W" && !b.freeHitSaved && b.keeperId != null
    && (b.dismissal === "stumped" || (b.dismissal === "caught" && isKeeperRef(b.keeperId, inn.keepers.find((k) => k.id === b.keeperId)?.name, b.fielder))))
    .map((b) => `${seqOf.get(b)}:${b.keeperId === K1 ? "k1" : "k2"}:${b.dismissal}`).join(" ");
  ok("§46: the keeper's dismissals, ball by ball", keeperWickets === "3:k1:caught 7:k2:stumped 8:k2:caught 13:k2:stumped", keeperWickets);
  const bw = inn.bowlers.find((b) => b.id === BW);
  const overs = inn.overLog.map((o) => `${o.over}/${o.balls.filter((b) => b.type !== "Nb" && b.type !== "Wd").length}/${o.balls.length}`).join(",");
  ok("§46: every other figure — (3,6,7), …03's innings (4,3), overs 0/6/7,1/1/1",
     inn.runs === 3 && inn.wickets === 6 && inn.balls === 7 && bw?.wickets === 4 && bw?.runs === 3 && overs === "0/6/7,1/1/1",
     { runs: inn.runs, wickets: inn.wickets, balls: inn.balls, bw, overs });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
