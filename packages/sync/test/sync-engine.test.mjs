/**
 * SCRBRD-074 / SCRBRD-075. Undo and the outbox: an event undone before it
 * was sent must never be sent, and an event the server may have must never be
 * cut from the pad's log — before a flush, during one, after a failed one,
 * and across a reload.
 *
 * The server is a fake with the one property that matters here: it remembers
 * every key it was sent and answers a repeat as a duplicate. The transport can
 * be held open, so a withdrawal can be tried while a flush is in flight.
 *
 *   node packages/sync/test/sync-engine.test.mjs
 */
import { inningsStart, batters, bowler, ball, BALL_TYPE, deriveInnings } from "@scrbrd/scoring";
import { SyncEngine, memoryStorage, undoOnPad } from "../src/index.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const SQUAD = [{ id: "p1", name: "S Dlamini" }, { id: "p2", name: "K Naidoo" }, { id: "p3", name: "T Mokoena" }];
let n = 0;
const w = (ev) => ({ ...ev, innings: 0, id: `dev:m:${++n}` });
const OPEN = w(inningsStart({ innings: 0, battingTeam: "A", bowlingTeam: "B", squad: SQUAD, bowlingSquad: [], overs: 20 }));
const PAIR = w(batters({ striker: "p1", nonStriker: "p2" }));
const NEL = w(bowler({ bowler: "A Nel" }));
const run = (v) => w(ball({ type: BALL_TYPE.RUN, value: v }));
const mint = () => `dev:m:${++n}`;

/** A server that keeps what it is sent. `hold()` makes the next request wait for `release()`. */
function fakeServer() {
  /** @type {string[]} */
  const log = [];
  const calls = [];
  let gate = null;
  let failNext = false;
  const transport = async (_matchId, batch) => {
    calls.push(batch.map((e) => e.idempotencyKey));
    if (gate) await gate.promise;
    const accepted = [], duplicates = [];
    for (const ev of batch) {
      const at = log.indexOf(ev.idempotencyKey);
      if (at >= 0) duplicates.push({ idempotencyKey: ev.idempotencyKey, seq: at + 1 });
      else { log.push(ev.idempotencyKey); accepted.push({ idempotencyKey: ev.idempotencyKey, seq: log.length }); }
    }
    if (failNext) { failNext = false; throw new Error("network down"); }
    return { accepted, duplicates };
  };
  return {
    log, calls, transport,
    hold() { let release; const promise = new Promise((r) => { release = r; }); gate = { promise, release }; },
    release() { const g = gate; gate = null; g?.release(); },
    /** The request reaches the server, the server writes it, and the answer is lost. */
    writeThenFail() { failNext = true; },
  };
}

/** An engine over this storage and server, with a switch for the signal. */
function device(storage, server, { epoch = 1 } = {}) {
  const net = { online: false };
  const engine = new SyncEngine({
    matchId: "m", deviceId: "dev", scorerId: "u", epoch, storage,
    transport: server.transport, isOnline: () => net.online,
  });
  return { engine, net };
}
const keysOnDisk = (storage, prefix) => [...storage._dump().keys()].filter((k) => k.startsWith(prefix));
const queuedOnDisk = (storage) => [...storage._dump().entries()]
  .filter(([k]) => k.startsWith("evt:")).map(([, v]) => JSON.parse(v).idempotencyKey);
const tick = () => new Promise((r) => setTimeout(r, 0));

group("A. Withdraw: an event that never left the device leaves the outbox, memory and disk");
{
  const storage = memoryStorage(), server = fakeServer();
  const { engine, net } = device(storage, server);
  await engine.init();
  for (const ev of [OPEN, PAIR, NEL]) await engine.record(ev);
  const B1 = run(1), B2 = run(4);
  await engine.record(B1); await engine.record(B2);
  ok("offline, all five wait in the outbox", engine.pendingCount === 5 && queuedOnDisk(storage).length === 5);
  ok("the last one has never left the device", engine.isUnsent(B2.id));
  ok("withdraw takes it", await engine.withdraw(B2.id) === true);
  ok("...out of memory", engine.pendingCount === 4 && !engine.pending.some((e) => e.idempotencyKey === B2.id));
  ok("...and off disk", !queuedOnDisk(storage).includes(B2.id), queuedOnDisk(storage));
  ok("a second withdraw of it is refused: nothing to take", await engine.withdraw(B2.id) === false);
  ok("an id the outbox never had is refused", await engine.withdraw("dev:m:nope") === false);
  net.online = true;
  await engine.sync();
  ok("online, the server gets the other four and never the withdrawn one",
     server.log.length === 4 && !server.log.includes(B2.id), server.log);
  ok("an acknowledged event is not unsent, and cannot be withdrawn",
     !engine.isUnsent(B1.id) && await engine.withdraw(B1.id) === false && server.log.includes(B1.id));
}

group("B. Mid-flush: an event in the request in flight is never withdrawn");
{
  const storage = memoryStorage(), server = fakeServer();
  const { engine, net } = device(storage, server);
  await engine.init();
  for (const ev of [OPEN, PAIR, NEL]) await engine.record(ev);
  const B1 = run(2);
  await engine.record(B1);
  server.hold();
  net.online = true;
  const flush = engine.sync();
  await tick();
  ok("the flush is in flight with the ball in it", engine.syncing && server.calls.at(-1)?.includes(B1.id));
  ok("a second sync() during the flush waits for that flush, not nothing", engine.sync() === flush);
  ok("it is no longer unsent: the server may be writing it now", !engine.isUnsent(B1.id));
  ok("...and withdraw refuses it", await engine.withdraw(B1.id) === false);
  ok("...leaving it queued, in memory and on disk", engine.pending.some((e) => e.idempotencyKey === B1.id) && queuedOnDisk(storage).includes(B1.id));
  const LOG = [[OPEN, PAIR, NEL, B1], []];
  const u = undoOnPad(LOG, 0, engine, mint);
  ok("the pad's undo of it is a void, not a cut", u.action === "void" && u.withdraw === null && u.log[0].at(-1)?.target === B1.id, u.action);
  // A ball tapped while the request is out is not in it, and can still go.
  const B2 = run(3);
  net.online = false;          // no second flush on record
  await engine.record(B2);
  ok("a ball recorded during the flush is not in it, and has never left", engine.isUnsent(B2.id));
  ok("...so it can be withdrawn while the flush is still out", await engine.withdraw(B2.id) === true);
  server.release();
  await flush;
  ok("the answer lands: the ball in flight is acknowledged", server.log.includes(B1.id) && engine.pendingCount === 0);
  net.online = true;
  await engine.sync();
  ok("...and the withdrawn one is never sent", !server.calls.flat().includes(B2.id), server.calls);
  // The void the pad appended goes out after it, and the two agree.
  const V = u.log[0].at(-1);
  await engine.record(V);
  await engine.sync();
  ok("the void follows the ball it undoes", server.log.at(-1) === V.id && server.log.at(-2) === B1.id);
}

group("C. A request that never answered: the server may have it, so it is a void");
{
  const storage = memoryStorage(), server = fakeServer();
  const { engine, net } = device(storage, server);
  await engine.init();
  for (const ev of [OPEN, PAIR, NEL]) await engine.record(ev);
  const B1 = run(6);
  await engine.record(B1);
  server.writeThenFail();
  net.online = true;
  await engine.sync();
  ok("the flush failed, and the ball is still pending", engine.pendingCount === 4 && !!engine.lastError);
  ok("...but the server wrote it before the answer was lost", server.log.includes(B1.id));
  ok("so it is not unsent, and withdraw refuses it", !engine.isUnsent(B1.id) && await engine.withdraw(B1.id) === false);
  ok("the pad voids it", undoOnPad([[OPEN, PAIR, NEL, B1], []], 0, engine).action === "void");
  ok("the sent marker was on disk before the request went out", keysOnDisk(storage, "sent:").includes(`sent:${B1.id}`));
}

group("D. The marker is written before the request leaves");
{
  const storage = memoryStorage();
  let sawMarkers = null;
  const engine = new SyncEngine({
    matchId: "m", deviceId: "dev", scorerId: "u", epoch: 1, storage, isOnline: () => false,
    transport: async (_m, batch) => {
      sawMarkers = batch.every((e) => storage._dump().has(`sent:${e.idempotencyKey}`));
      return { accepted: batch.map((e, i) => ({ idempotencyKey: e.idempotencyKey, seq: i + 1 })) };
    },
  });
  await engine.init();
  await engine.record(OPEN); await engine.record(PAIR);
  engine.isOnline = () => true;
  await engine.sync();
  ok("every event in the batch was marked sent on disk when the transport was called", sawMarkers === true);
}

group("E. After a reload (SCRBRD-075): what was sent stays sent, what was withdrawn stays gone");
{
  const storage = memoryStorage(), server = fakeServer();
  const first = device(storage, server);
  await first.engine.init();
  for (const ev of [OPEN, PAIR, NEL]) await first.engine.record(ev);
  const B1 = run(1);
  await first.engine.record(B1);
  first.net.online = true;
  await first.engine.sync();
  ok("online, the first session sends four", server.log.length === 4);
  first.net.online = false;
  const B2 = run(2), B3 = run(4);
  await first.engine.record(B2); await first.engine.record(B3);
  await first.engine.withdraw(B3.id);

  // The tab dies. A new session opens the same storage, and the pad re-offers
  // its whole log (engine.jsx), which is what used to make every ball look new.
  const again = device(storage, server);
  await again.engine.init();
  ok("only the unsent ball comes back from disk", again.engine.pending.map((e) => e.idempotencyKey).join() === B2.id);
  const padLog = [OPEN, PAIR, NEL, B1, B2];
  for (const ev of padLog) await again.engine.record(ev);
  ok("re-offering the log does not queue the waiting ball twice", again.engine.pending.filter((e) => e.idempotencyKey === B2.id).length === 1);
  ok("a ball the server acknowledged last session is still not unsent", !again.engine.isUnsent(B1.id));
  ok("...and the ball that never left still is", again.engine.isUnsent(B2.id));
  const undo1 = undoOnPad([padLog, []], 0, again.engine);
  ok("undo of the unsent ball: cut and withdrawn", undo1.action === "truncate" && undo1.withdraw === B2.id);
  await again.engine.withdraw(B2.id);
  const undo2 = undoOnPad([undo1.log[0], []], 0, again.engine, mint);
  ok("undo of the ball the server has, offline after a reload: a void, never a cut", undo2.action === "void" && undo2.withdraw === null);
  await again.engine.record(undo2.log[0].at(-1));
  again.net.online = true;
  await again.engine.sync();
  const serverLog = server.log;
  ok("the server's log is the pad's log, id for id", JSON.stringify(serverLog) === JSON.stringify(undo2.log[0].map((e) => e.id)),
     { server: serverLog, pad: undo2.log[0].map((e) => e.id) });
  ok("...and neither withdrawn ball ever reached it", !server.calls.flat().includes(B3.id) && !server.calls.flat().includes(B2.id));
  ok("...and the board agrees: one run, the four and the two gone", deriveInnings(undo2.log[0]).runs === 0);
}

group("F. A reload that reclaims the match: its own queued balls go out under the new token");
{
  const storage = memoryStorage(), server = fakeServer();
  const first = device(storage, server, { epoch: 3 });
  await first.engine.init();
  await first.engine.record(OPEN); await first.engine.record(PAIR);
  const next = device(storage, server, { epoch: 4 });
  await next.engine.init();
  ok("queued under the epoch just before: restamped", next.engine.pending.every((e) => e.epoch === 4));
  ok("...on disk too", [...storage._dump().entries()].filter(([k]) => k.startsWith("evt:")).every(([, v]) => JSON.parse(v).epoch === 4));
  const later = device(storage, server, { epoch: 6 });
  await later.engine.init();
  ok("someone else held the token since (epoch jumped by two): left stale, for quarantine",
     later.engine.pending.every((e) => e.epoch === 4));
}

group("G. Storage refuses the delete: the event goes back in the queue, and the caller is told");
{
  const storage = memoryStorage();
  const del = storage.delete;
  const server = fakeServer();
  const { engine } = device(storage, server);
  await engine.init();
  await engine.record(OPEN);
  const B1 = run(1);
  await engine.record(B1);
  storage.delete = async () => { throw new Error("quota"); };
  let threw = false;
  try { await engine.withdraw(B1.id); } catch { threw = true; }
  storage.delete = del;
  ok("withdraw rejects", threw);
  ok("...and the event is queued again, in order, still unsent",
     engine.pending.map((e) => e.idempotencyKey).join() === [OPEN.id, B1.id].join() && engine.isUnsent(B1.id));
}

console.log(`\n${"─".repeat(52)}\nSYNC ENGINE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
