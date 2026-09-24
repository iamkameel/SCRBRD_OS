/**
 * SCRBRD-070. An event the server would not write, and what a person does
 * about it (packages/sync/src/held.mjs).
 *
 * The server is simulated with the server's own pieces — MatchFold and
 * lawsRefusal, judged one event at a time against the log so far, exactly as
 * appendEvents does inside the per-match lock — so "refused" below means what
 * the server would refuse, not what this file decided to call refused.
 *
 *   node packages/sync/test/held.test.mjs
 */
import {
  inningsStart, batters, bowler, ball, voidEvent, BALL_TYPE, deriveInnings, MatchFold,
  lawsRefusal, REFUSAL, REFUSAL_TEXT,
} from "@scrbrd/scoring";
import {
  SyncEngine, memoryStorage, heldFrom, heldInOrder, withoutEvents, serverView, inLog,
  recordAgainRefusal, recordAgain, describeHeld, describeEvent, reasonWords, CONFLICT_TEXT,
} from "../src/index.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const SQUAD = [{ id: "p1", name: "S Dlamini" }, { id: "p2", name: "K Naidoo" }, { id: "p3", name: "T Mokoena" }];
let n = 0;
const id = () => `dev:m:${++n}`;
const withId = (ev) => ({ ...ev, id: id() });
const run = (v, o = {}) => withId(ball({ type: BALL_TYPE.RUN, value: v, ...o }));

/** The server: judge each event against the log so far; write the legal ones. */
function serve(evs, fold = new MatchFold([])) {
  const accepted = [], refused = [];
  let seq = 1000;
  for (const ev of evs) {
    const why = lawsRefusal(fold.view(), ev);
    if (why) { refused.push({ idempotencyKey: ev.id, reason: why }); continue; }
    fold.push({ ...ev, seq: ++seq });
    accepted.push(ev);
  }
  return { accepted, refused, fold };
}

/** What the engine holds after the server answered: the queued event + state. */
const asHeld = (log, refused, state = "refused") => {
  const all = log.flat();
  return refused.map((r) => {
    const i = all.findIndex((e) => e.id === r.idempotencyKey);
    return { idempotencyKey: r.idempotencyKey, clientSeq: i + 1, payload: all[i], state, reason: r.reason,
             matchId: "m", deviceId: "dev", scorerId: "u", epoch: 1, innings: 0, clientTs: 0 };
  });
};
const fig = (inn) => inn && { runs: inn.runs, wickets: inn.wickets, balls: inn.balls, bowler: inn.bowler, striker: inn.striker };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One over by A Nel, then A Nel again — Law 17.8 — and two balls after it.
const OPEN = withId(inningsStart({ battingTeam: "HIL", bowlingTeam: "MHS", squad: SQUAD, bowlingSquad: [], overs: 20 }));
const PAIR = withId(batters({ striker: "p1", nonStriker: "p2" }));
const NEL = withId(bowler({ bowler: "A Nel" }));
const OVER1 = [1, 0, 0, 4, 0, 0].map((v) => run(v));
const NEL_AGAIN = withId(bowler({ bowler: "A Nel" }));
const B1 = run(4, { striker: "p2", nonStriker: "p1", bowler: "A Nel" });
const B2 = run(2, { striker: "p2", nonStriker: "p1", bowler: "A Nel" });
const LOG = [[OPEN, PAIR, NEL, ...OVER1, NEL_AGAIN, B1, B2], []];

group("A. Every reason the server can give has words");
{
  const missing = Object.values(REFUSAL).filter((code) => !REFUSAL_TEXT[code]);
  ok("REFUSAL_TEXT covers every REFUSAL code", missing.length === 0, missing);
  ok("...and the conflict, which is not a Law", !!REFUSAL_TEXT.idempotency_conflict);
  ok("reasonWords uses the Laws' text", reasonWords("consecutive_overs") === REFUSAL_TEXT.consecutive_overs);
  ok("...an unknown code is shown as itself, not swallowed", reasonWords("brand_new_rule") === "brand_new_rule");
  ok("...and a missing one says so", /no reason/.test(reasonWords(null)));
}

group("B. The cascade, as the server sees it");
const served = serve(LOG[0]);
const HELD = asHeld(LOG, served.refused);
{
  ok("the second over by the same bowler is refused (Law 17.8)",
     served.refused[0]?.idempotencyKey === NEL_AGAIN.id && served.refused[0]?.reason === "consecutive_overs", served.refused);
  ok("...and so is every ball after it: the server never had a bowler for them",
     served.refused.length === 3 && served.refused.slice(1).every((r) => r.reason === "next_bowler"), served.refused);
  ok("the server's log is the pad's log with the held events taken out",
     same(serverView(LOG, HELD)[0].map((e) => e.id), served.accepted.map((e) => e.id)));
  ok("so the pad's board, until then, counts 6 runs the server does not have",
     deriveInnings(LOG[0]).runs - served.fold.view().innings[0].runs === 6);
  ok("heldFrom: the bowler and the two held after it, in order",
     same(heldFrom(HELD, NEL_AGAIN.id).map((h) => h.idempotencyKey), [NEL_AGAIN.id, B1.id, B2.id]));
  ok("...from the middle, only what comes after", same(heldFrom(HELD, B1.id).map((h) => h.idempotencyKey), [B1.id, B2.id]));
  ok("...and nothing for a key that is not held", heldFrom(HELD, "nope").length === 0);
  ok("heldInOrder does not trust the array's order", same(heldInOrder([...HELD].reverse()).map((h) => h.idempotencyKey), HELD.map((h) => h.idempotencyKey)));
}

group("C. Discard: the pad's log loses exactly those, and then agrees with the server");
{
  const one = withoutEvents(LOG, [B2.id]);
  ok("discarding one takes it out of the log", !inLog(one, B2.id) && inLog(one, B1.id));
  ok("...leaves every other event where it was", one[0].length === LOG[0].length - 1);
  ok("...and does not rebuild an innings that lost nothing", one[1] === LOG[1]);
  ok("the board drops its runs", deriveInnings(one[0]).runs === deriveInnings(LOG[0]).runs - 2);

  const all = withoutEvents(LOG, heldFrom(HELD, NEL_AGAIN.id).map((h) => h.idempotencyKey));
  ok("discarding the bowler and everything held after it: pad and server hold the same events",
     same(all[0].map((e) => e.id), served.accepted.map((e) => e.id)));
  ok("...and the same figures", same(fig(deriveInnings(all[0])), fig(served.fold.view().innings[0])));
}

group("D. Discarding the cause does not make the rest legal — so nothing is resent on its own");
{
  const noBowler = withoutEvents(LOG, [NEL_AGAIN.id]);
  const rest = HELD.filter((h) => h.idempotencyKey !== NEL_AGAIN.id);
  const why = recordAgainRefusal(noBowler, rest, rest);
  ok("recording the balls again straight after is predicted refused: still nobody bowling",
     why?.key === B1.id && why?.reason === "next_bowler", why);
  ok("...and the server agrees", serve([ { ...B1, id: "x1" } ], serve(serverView(noBowler, rest)[0]).fold).refused[0]?.reason === "next_bowler");
}

group("E. Record again, once the scorer has named the right bowler");
{
  // The scorer discards the mis-tapped bowler and names B Botha on the pad.
  const botha = withId(bowler({ bowler: "B Botha" }));
  const base = withoutEvents(LOG, [NEL_AGAIN.id]);
  base[0] = [...base[0], botha];
  const rest = HELD.filter((h) => h.idempotencyKey !== NEL_AGAIN.id);
  ok("both balls are now predicted accepted, in order", recordAgainRefusal(base, rest, rest) === null);
  ok("...the first alone too", recordAgainRefusal(base, rest, [rest[0]]) === null);

  const before = new Set(base.flat().map((e) => e.id));
  const { log: next, copies } = recordAgain(base, rest, rest, id);
  ok("two copies, each with a new id", copies.length === 2 && copies.every((c) => !before.has(c.id)));
  ok("...naming the key each replaces", copies[0].resentFrom === B1.id && copies[1].resentFrom === B2.id);
  ok("the originals are gone from the log — nothing twice", !inLog(next, B1.id) && !inLog(next, B2.id));
  ok("...and the copies are at the end, in order, after the new bowler",
     same(next[0].slice(-3).map((e) => e.id), [botha.id, copies[0].id, copies[1].id]));
  ok("every id in the log is unique", new Set(next.flat().map((e) => e.id)).size === next.flat().length);
  ok("the same deliveries: runs and type kept", copies[0].value === 4 && copies[1].value === 2 && copies.every((c) => c.type === "run"));
  ok("...credited to the bowler at the crease now, not the one refused", copies.every((c) => c.bowler === "B Botha"), copies.map((c) => c.bowler));
  ok("...and to the batter facing now (odd runs at the over's end rotated the strike)",
     copies[0].striker === deriveInnings([...base[0]]).striker);

  const server = serve([...served.accepted, botha, ...copies]);
  ok("the server accepts all of it", server.refused.length === 0, server.refused);
  ok("...and the pad and the server agree, event for event", same(next[0].map((e) => e.id), server.accepted.map((e) => e.id)));
  ok("...and figure for figure", same(fig(deriveInnings(next[0])), fig(server.fold.view().innings[0])));
}

group("F. A conflict is only ever discarded; an event off the board is not recorded again");
{
  const conflict = { ...HELD[1], state: /** @type {const} */ ("conflict"), reason: "idempotency_conflict" };
  ok("a conflict is never recorded again", recordAgainRefusal(LOG, [conflict], [conflict])?.reason === "idempotency_conflict");
  const undone = withoutEvents(LOG, [B2.id]);
  ok("a held ball the scorer has since undone is not put back", recordAgainRefusal(undone, HELD, [HELD[2]])?.reason === "not_on_board");
}

group("G. In words");
{
  const innings = LOG.map((evs) => (evs.length ? deriveInnings(evs) : null));
  const bw = describeHeld(HELD[0], LOG, innings);
  ok("a bowler, by name", bw.what === "Bowler — A Nel to bowl", bw.what);
  ok("...refused, with the Law in words", bw.why === `The server refused this: ${REFUSAL_TEXT.consecutive_overs}.`, bw.why);
  ok("...and still on the board", bw.onBoard === true);
  const b = describeHeld(HELD[1], LOG, innings);
  ok("a ball, with the players' names from the squad", b.what === "Ball — 4 runs, K Naidoo facing A Nel", b.what);
  const c = describeHeld({ ...HELD[1], state: "conflict", reason: "idempotency_conflict" }, LOG, innings);
  ok("a conflict says the server keeps its own and discarding is the fix", c.why === `The server ${CONFLICT_TEXT}` && /discarding it/.test(c.why));
  ok("a pair of batters", describeEvent(PAIR, innings[0]) === "Batters — S Dlamini (on strike) and K Naidoo");
  ok("a wicket", describeEvent(ball({ type: "W", value: 0, dismissal: "bowled", striker: "p1", bowler: "A Nel" }), innings[0])
     === "Wicket — S Dlamini Bowled (bowling: A Nel)");
  ok("a wide", describeEvent(ball({ type: "Wd", value: 1 }), innings[0]) === "Wide + 1 run");
  ok("an undo names what it undid", describeEvent(voidEvent({ target: B1.id }), innings[0], (k) => LOG[0].find((e) => e.id === k))
     === "Undo — of \"Ball — 4 runs, K Naidoo facing A Nel\"");
  ok("an unknown player id is shown as itself", describeEvent(bowler({ bowler: "Z Unknown" }), innings[0]) === "Bowler — Z Unknown to bowl");
}

group("H. The engine: a held event is not queued again when the pad re-offers its log");
{
  const storage = memoryStorage();
  let calls = 0;
  const transport = async (_m, batch) => {
    calls++;
    return { refused: batch.map((e) => ({ idempotencyKey: e.idempotencyKey, reason: "next_bowler" })) };
  };
  const e = new SyncEngine({ matchId: "m", deviceId: "dev", scorerId: "u", epoch: 1, storage, transport, isOnline: () => false });
  await e.init();
  await e.record(B1);
  e.isOnline = () => true;
  await e.sync();
  ok("the refused ball is held", e.held.length === 1 && e.held[0].idempotencyKey === B1.id);

  // A reload: a fresh engine on the same storage, and the pad offering its
  // whole log again (engine.jsx's queue effect starts with nothing queued).
  const again = new SyncEngine({ matchId: "m", deviceId: "dev", scorerId: "u", epoch: 1, storage, transport, isOnline: () => true });
  await again.init();
  const r = await again.record(B1);
  await again.sync();
  ok("offering it again queues nothing", again.pendingCount === 0 && calls === 1);
  ok("...holds it once, not twice", again.held.length === 1 && (await storage.list("held:")).length === 1);
  ok("...and answers with the held copy", r.idempotencyKey === B1.id);

  // Recorded again under a new id, it is a new event and goes.
  const copy = { ...B1, id: "dev:m:copy", resentFrom: B1.id };
  again.isOnline = () => false;
  await again.record(copy);
  again.isOnline = () => true;
  await again.sync();
  ok("a copy with a new id is queued and sent", calls === 2);
  ok("...and, refused again, is held under its own key — two held, one each", again.held.length === 2
     && new Set(again.held.map((h) => h.idempotencyKey)).size === 2);
  ok("discarding the original lets exactly that one go", await again.discardHeld(B1.id) === true
     && again.held.length === 1 && again.held[0].idempotencyKey === copy.id);
  ok("...and a second discard of it finds nothing", await again.discardHeld(B1.id) === false);
}

console.log(`\n${"─".repeat(52)}\nHELD: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
