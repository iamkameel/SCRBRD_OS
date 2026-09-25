/**
 * SCRBRD-078 / SCRBRD-075 / SCRBRD-079. A live match's pad attaching to the
 * server: the log is never split, never silently different, and a match
 * somebody else holds is never taken by a pad that reopened on its own.
 *
 * The server is a fake that answers the three calls an attach makes (probe,
 * log, claim) and counts them, so each rule is proved by what was — and was
 * not — asked of it.
 *
 *   node packages/sync/test/attach.test.mjs
 */
import { inningsStart, batters, bowler, ball, sealInnings, deriveInnings, BALL_TYPE } from "@scrbrd/scoring";
import {
  SyncEngine, memoryStorage, reconcile, padLogFrom, inningsInPlay, withOrphans,
  tryAttach, RETRY, tossDecision, playRecorded, waitingPhrase, tossLine,
} from "../src/index.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const SQUAD = [{ id: "p1", name: "S Dlamini" }, { id: "p2", name: "K Naidoo" }];
let n = 0;
const w = (ev, dev = "A") => ({ ...ev, innings: ev.innings ?? 0, id: `${dev}:m:${++n}` });
const OPEN = w(inningsStart({ innings: 0, battingTeam: "Home", bowlingTeam: "Away", squad: SQUAD, bowlingSquad: [], overs: 20 }));
const PAIR = w(batters({ striker: "p1", nonStriker: "p2" }));
const NEL = w(bowler({ bowler: "A Nel" }));
const run = (v, dev = "A") => w(ball({ type: BALL_TYPE.RUN, value: v, striker: "p1", nonStriker: "p2", bowler: "A Nel" }), dev);
/** The server's copy of an event: fromRow adds its seq. */
const onServer = (evs) => evs.map((e, i) => ({ ...e, seq: i + 1 }));

/** A fake server. `probe`: the session as the heartbeat reports it. */
function server({ log = [], probe = { ok: false, epoch: null, state: null, reason: "no_session" }, claim = { ok: true, epoch: 1 } } = {}) {
  const calls = { probe: 0, log: 0, claim: 0 };
  return {
    calls,
    api: {
      probe: async () => { calls.probe++; if (probe instanceof Error) throw probe; return probe; },
      log: async () => { calls.log++; return log; },
      claim: async () => { calls.claim++; return claim; },
    },
  };
}
async function engineWith({ heldEpoch = null, pending = [] } = {}) {
  const storage = memoryStorage();
  if (heldEpoch != null) await storage.put("meta:epoch", String(heldEpoch));
  const engine = new SyncEngine({ matchId: "m", deviceId: "A", scorerId: "u", epoch: null, storage,
    transport: async () => ({}), isOnline: () => false });
  await engine.init();
  for (const ev of pending) await engine.record(ev);
  return { engine, storage };
}

group("A. reconcile: the pad's log and the server's, by id");
{
  const pad = [[OPEN, PAIR, NEL, run(1)], []];
  const inStep = reconcile(pad, onServer([OPEN, PAIR]));
  ok("the server has nothing the pad lacks: in step, and the rest is the pad's to send",
     inStep.state === "in_step" && inStep.extra.length === 0 && inStep.mine.length === 2, inStep);
  const B1 = run(4, "B");
  const behind = reconcile([[OPEN, PAIR], []], onServer([OPEN, PAIR, NEL, B1]));
  ok("the server has more and the pad nothing of its own: behind", behind.state === "behind" && behind.extra.length === 2 && behind.mine.length === 0, behind);
  ok("an empty pad against a server log: behind (a first visit)", reconcile([[], []], onServer([OPEN])).state === "behind");
  const A2 = run(6);
  const fork = reconcile([[OPEN, PAIR, NEL, A2], []], onServer([OPEN, PAIR, NEL, B1]));
  ok("each has what the other lacks: a fork", fork.state === "fork" && fork.extra[0] === B1.id && fork.mine[0] === A2.id, fork);
  const held = reconcile([[OPEN, PAIR, NEL, A2], []], onServer([OPEN, PAIR, NEL, B1]), { held: [{ idempotencyKey: A2.id }] });
  ok("a held event is not the pad's to send: behind, not a fork", held.state === "behind", held);
  ok("both empty: in step", reconcile([[], []], []).state === "in_step");
}

group("B. orphans: queued on the device, lost from its saved log");
{
  const lost = run(2);
  const r = reconcile([[OPEN, PAIR, NEL], []], onServer([OPEN, PAIR, NEL]),
    { pending: [{ idempotencyKey: lost.id, clientSeq: 9, payload: lost }] });
  ok("an event the queue has and neither log has is an orphan, and the pad's to send",
     r.orphans.length === 1 && r.mine.includes(lost.id) && r.state === "in_step", r);
  const back = withOrphans([[OPEN, PAIR, NEL], []], r.orphans);
  ok("withOrphans puts it back at the end of its innings", back[0].at(-1)?.id === lost.id && back[0].length === 4);
  ok("an orphan against a server that moved on is a fork",
     reconcile([[OPEN], []], onServer([OPEN, PAIR]), { pending: [{ idempotencyKey: lost.id, clientSeq: 1, payload: lost }] }).state === "fork");
}

group("C. padLogFrom / inningsInPlay");
{
  const log = padLogFrom(onServer([OPEN, PAIR, w(inningsStart({ innings: 1, battingTeam: "Away", bowlingTeam: "Home" }))]));
  ok("one array per innings, in the server's order", log[0].length === 2 && log[1].length === 1 && log[0][0].id === OPEN.id);
  ok("the server's seq is not part of the pad's event", log[0].every((e) => !("seq" in e)));
  ok("the innings in play is the last with anything in it", inningsInPlay(log) === 1);
  ok("the first, while the second has nothing", inningsInPlay([[OPEN, PAIR], []]) === 0);
  // A first innings the scorer has closed: the break, and the second is next.
  const oneOver = [w(inningsStart({ innings: 0, battingTeam: "Home", bowlingTeam: "Away", squad: SQUAD, bowlingSquad: [], overs: 1 })),
    PAIR, NEL, ...[1, 0, 2, 0, 4, 1].map((v) => run(v))];
  ok("(an over's innings is complete)", deriveInnings(oneOver).complete === true);
  const sealed = [...oneOver, w(sealInnings(deriveInnings(oneOver)))];
  ok("(and the seal holds)", deriveInnings(sealed).sealed === true);
  ok("a closed first innings with nothing after: the second is in play", inningsInPlay([sealed, []]) === 1);
  ok("...an open one that is merely over is still the first", inningsInPlay([oneOver, []]) === 0);
}

group("D. tryAttach, in step: compared, claimed, attached with the queue rebased");
{
  const B1 = run(1);
  const { engine } = await engineWith({ heldEpoch: 2, pending: [B1] });
  const s = server({ log: onServer([OPEN, PAIR, NEL]), probe: { ok: false, epoch: 2, state: "active", reason: "not_token_holder" }, claim: { ok: true, epoch: 3 } });
  let adopted = null;
  const r = await tryAttach({ engine, server: s.api, padLog: () => [[OPEN, PAIR, NEL, B1], []], adopt: (l) => { adopted = l; }, intent: "restore" });
  ok("its own lapsed token (the generation has not moved): claimed, even reopened by itself", r.ok && r.epoch === 3 && s.calls.claim === 1, r);
  ok("the pad's log is not replaced", adopted === null);
  ok("what the server has is marked sent", engine.isKnown(OPEN.id) && !engine.isUnsent(OPEN.id));
  ok("the queue goes out under the claim's generation", engine.attached && engine.pending.every((e) => e.epoch === 3));
}

group("E. tryAttach, behind: the pad takes the server's log and never starts its own (SCRBRD-075)");
{
  const B1 = run(4, "B");
  const { engine } = await engineWith();
  const S = onServer([OPEN, PAIR, NEL, B1]);
  const s = server({ log: S, probe: { ok: false, epoch: 1, state: "active", reason: "not_token_holder" }, claim: { ok: false, reason: "lease_active", epoch: 1 } });
  let adopted = null;
  const r = await tryAttach({ engine, server: s.api, padLog: () => [[], []], adopt: (l) => { adopted = l; }, intent: "open" });
  ok("a first visit: the server's log becomes the pad's", adopted && adopted[0].map((e) => e.id).join() === S.map((e) => e.id).join(), adopted);
  ok("...marked sent before it is on the pad, so it is never queued", engine.isKnown(B1.id) && engine.pendingCount === 0);
  ok("the claim is the database's to refuse: someone else is scoring", !r.ok && r.reason === "lease_active" && s.calls.claim === 1, r);
  ok("...an answer, not a retry", !RETRY.has(r.reason));
  // The same, but the scorer tapped between the comparison and the adopt.
  const { engine: e2 } = await engineWith();
  const r2 = await tryAttach({ engine: e2, server: server({ log: S }).api, padLog: () => [[], []], adopt: () => false });
  ok("a tap after the comparison: not adopted, and asked again ('busy', which retries)", !r2.ok && r2.reason === "busy" && RETRY.has("busy"), r2);
}

group("F. tryAttach, fork: nothing merged, nothing claimed");
{
  const A9 = run(6), B9 = run(1, "B");
  const { engine } = await engineWith({ heldEpoch: 1, pending: [A9] });
  const s = server({ log: onServer([OPEN, PAIR, NEL, B9]) });
  let adopted = null;
  const r = await tryAttach({ engine, server: s.api, padLog: () => [[OPEN, PAIR, NEL, A9], []], adopt: (l) => { adopted = l; }, intent: "open" });
  ok("a fork is refused by name, with both sides counted", !r.ok && r.reason === "fork" && r.reconcile?.extra.length === 1 && r.reconcile?.mine.length === 1, r);
  ok("...and no claim is made, even by a person opening the pad", s.calls.claim === 0);
  ok("...and neither log is touched", adopted === null && engine.pendingCount === 1 && !engine.attached);
  ok("...an answer, not a retry", !RETRY.has("fork"));
}

group("G. A handover under way is never claimed past (the arming device's claim is its cancel)");
{
  for (const state of ["handover_pending", "verifying"]) {
    const { engine } = await engineWith({ heldEpoch: 4 });
    const s = server({ probe: { ok: false, epoch: 4, state, reason: "not_token_holder" } });
    const r = await tryAttach({ engine, server: s.api, padLog: () => [[OPEN], []], adopt: () => {}, intent: "open" });
    ok(`${state}: refused by name, no log read, no claim`, !r.ok && r.reason === state && s.calls.claim === 0 && s.calls.log === 0, r);
  }
}

group("H. A pad that reopened by itself never takes a match another device claimed since");
{
  const { engine } = await engineWith({ heldEpoch: 3 });
  const s = server({ log: onServer([OPEN, PAIR]), probe: { ok: false, epoch: 5, state: "active", reason: "not_token_holder" }, claim: { ok: true, epoch: 6 } });
  const r = await tryAttach({ engine, server: s.api, padLog: () => [[OPEN, PAIR], []], adopt: () => {}, intent: "restore" });
  ok("restored: the generation moved on (5, not 3) — no claim, words instead", !r.ok && r.reason === "moved_on" && s.calls.claim === 0, r);
  const s2 = server({ log: onServer([OPEN, PAIR]), probe: { ok: false, epoch: 5, state: "active", reason: "not_token_holder" }, claim: { ok: true, epoch: 6 } });
  const r2 = await tryAttach({ engine, server: s2.api, padLog: () => [[OPEN, PAIR], []], adopt: () => {}, intent: "open" });
  ok("a person asks to score here: the claim is made, and the database decides", r2.ok && r2.epoch === 6 && s2.calls.claim === 1, r2);
  const { engine: e3 } = await engineWith({ heldEpoch: 3 });
  const s3 = server({ log: [], probe: { ok: false, epoch: 3, state: "idle", reason: "not_token_holder" }, claim: { ok: true, epoch: 4 } });
  ok("an idle session is nobody's: claimed", (await tryAttach({ engine: e3, server: s3.api, padLog: () => [[], []], adopt: () => {}, intent: "restore" })).ok);
}

group("I. A finished match: nothing claimed, but the comparison is kept (SCRBRD-079)");
{
  const { engine } = await engineWith({ heldEpoch: 2 });
  const s = server({ log: onServer([OPEN, PAIR]), probe: { ok: false, epoch: 2, state: null, reason: "match_complete" } });
  const r = await tryAttach({ engine, server: s.api, padLog: () => [[OPEN, PAIR], []], adopt: () => {} });
  ok("match_complete: no claim, and the log comparison says the pad's is all there",
     !r.ok && r.reason === "match_complete" && s.calls.claim === 0 && r.reconcile?.mine.length === 0, r);
  const { engine: e2 } = await engineWith();
  ok("no capability: refused before the log is read",
     (await tryAttach({ engine: e2, server: server({ probe: { ok: false, epoch: null, state: null, reason: "no_capability" } }).api, padLog: () => [[], []], adopt: () => {} })).reason === "no_capability");
  const { engine: e3 } = await engineWith();
  let threw = false;
  try { await tryAttach({ engine: e3, server: server({ probe: new Error("Failed to fetch") }).api, padLog: () => [[], []], adopt: () => {} }); }
  catch { threw = true; }
  ok("no answer at all is the caller's to classify (it throws)", threw);
}

group("J. Orphans are put back on the pad before anything is claimed");
{
  const lost = run(3);
  const { engine } = await engineWith({ heldEpoch: 1, pending: [lost] });
  let restored = null;
  const s = server({ log: onServer([OPEN, PAIR, NEL]), probe: { ok: false, epoch: 1, state: "active", reason: "not_token_holder" }, claim: { ok: true, epoch: 2 } });
  const r = await tryAttach({ engine, server: s.api, padLog: () => [[OPEN, PAIR, NEL], []], adopt: () => {}, restore: (o) => { restored = o; } });
  ok("the lost ball goes back on the pad, and is sent", r.ok && restored?.[0]?.idempotencyKey === lost.id && r.restored === 1, r);
}

group("K. The toss against the server's (SCRBRD-075)");
{
  const mine = { wonBy: "home", decision: "bat" };
  const onlyStart = [[OPEN], []];
  ok("the server has none, and no event: send it", tossDecision({ mine, server: null, serverHasEvents: false, log: onlyStart }).action === "send");
  ok("the server has none but has events: frozen — stop, in words",
     tossDecision({ mine, server: null, serverHasEvents: true, log: onlyStart }).reason === "toss_locked");
  ok("the same toss: settled, nothing sent", tossDecision({ mine, server: { ...mine }, serverHasEvents: true, log: onlyStart }).action === "settled");
  const theirs = { wonBy: "away", decision: "bat" };
  ok("a different toss, nothing on the server, nothing on the pad but the start: follow the server's",
     tossDecision({ mine, server: theirs, serverHasEvents: false, log: onlyStart }).action === "follow");
  ok("a different toss once the server has events: stop, never written over",
     tossDecision({ mine, server: theirs, serverHasEvents: true, log: onlyStart }).reason === "toss_conflict");
  ok("a different toss with play recorded on the pad: stop — no rule is invented for which is true",
     tossDecision({ mine, server: theirs, serverHasEvents: false, log: [[OPEN, PAIR], []] }).reason === "toss_conflict");
  ok("playRecorded: the start alone is not play; batters are", !playRecorded(onlyStart) && playRecorded([[OPEN, PAIR], []]));
  ok("tossLine says it in words", /Away won the toss and chose to bat \(Away bat first\)/.test(tossLine(theirs, "Home", "Away")), tossLine(theirs, "Home", "Away"));
}

group("L. What is waiting, in words");
{
  const ev = (kind) => ({ payload: { kind } });
  ok("balls", waitingPhrase([ev("ball"), ev("ball")]) === "2 balls");
  ok("one ball", waitingPhrase([ev("ball")]) === "1 ball");
  ok("balls and other changes", waitingPhrase([ev("ball"), ev("bowler")]) === "1 ball and 1 other change");
  ok("no balls", waitingPhrase([ev("batters"), ev("bowler")]) === "2 changes to the scorebook");
}

console.log(`\n${"─".repeat(52)}\nATTACH: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
