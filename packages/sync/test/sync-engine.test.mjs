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

// ── SCRBRD-078: an outbox that opens before the token ────────────

/** An engine that holds no token yet: epoch null. */
function unattached(storage, server, { gate, settleToss } = {}) {
  const net = { online: true };
  const engine = new SyncEngine({
    matchId: "m", deviceId: "dev", scorerId: "u", epoch: null, storage,
    transport: server.transport, isOnline: () => net.online, gate, settleToss,
  });
  return { engine, net };
}

group("H. Unattached (SCRBRD-078): recorded on disk at once, sent only once attached");
{
  const storage = memoryStorage(), server = fakeServer();
  // The device held generation 4 of this match before the reload.
  await storage.put("meta:epoch", "4");
  const { engine } = unattached(storage, server);
  await engine.init();
  ok("it opens unattached, stamping with the generation it last held", !engine.attached && engine.epoch === 4 && engine.heldEpoch === 4);
  const B1 = run(1);
  for (const ev of [OPEN, PAIR, NEL, B1]) await engine.record(ev);
  await tick();
  ok("everything is queued on disk, with signal and all", queuedOnDisk(storage).length === 4 && engine.pendingCount === 4);
  ok("...and nothing is sent: no token", server.calls.length === 0);
  const r = await engine.sync();
  ok("sync() says why it sent nothing", r.unattached === true && r.remaining === 4, r);
  ok("each is stamped with the generation it last held", engine.pending.every((e) => e.epoch === 4));

  // A restart, still unattached: the queue and the generation come back.
  const again = unattached(storage, server).engine;
  await again.init();
  ok("a reload brings back the queue and the generation", again.pendingCount === 4 && again.epoch === 4 && !again.attached);

  // The claim succeeds under 5: the device's own continuation, restamped.
  await again.attach(5);
  ok("attach(5): events under 4 (= 5 − 1) are restamped", again.attached && again.pending.every((e) => e.epoch === 5));
  ok("...on disk too", [...storage._dump().entries()].filter(([k]) => k.startsWith("evt:")).every(([, v]) => JSON.parse(v).epoch === 5));
  ok("...and the generation held is on disk", storage._dump().get("meta:epoch") === "5");
  await again.sync();
  ok("now it sends, in order", JSON.stringify(server.log) === JSON.stringify([OPEN, PAIR, NEL, B1].map((e) => e.id)), server.log);
}

group("H2. The epoch rule at attach: older is left for quarantine, unless the caller rebases");
{
  const storage = memoryStorage(), server = fakeServer();
  await storage.put("meta:epoch", "2");
  const first = unattached(storage, server).engine;
  await first.init();
  await first.record(OPEN); await first.record(PAIR);
  // Somebody else held 3 and 4; this device's claim gets 5.
  await first.attach(5);
  ok("without rebase, events two generations old stay stale — for quarantine", first.pending.every((e) => e.epoch === 2));
  const storage2 = memoryStorage();
  await storage2.put("meta:epoch", "2");
  const second = unattached(storage2, fakeServer()).engine;
  await second.init();
  await second.record(OPEN); await second.record(PAIR);
  // The caller compared logs and nobody had written: rebase.
  await second.attach(5, { rebase: true });
  ok("with rebase, every queued event goes out under the new generation", second.pending.every((e) => e.epoch === 5));
  const fresh = unattached(memoryStorage(), fakeServer()).engine;
  await fresh.init();
  ok("a device that never held the match stamps generation 0", fresh.epoch === 0 && fresh.heldEpoch === null);
}

group("H3. detach: the token is gone, the queue is not");
{
  const storage = memoryStorage(), server = fakeServer();
  const { engine } = device(storage, server);
  await engine.init();
  engine.detach("handed_over");
  await engine.record(OPEN);
  const r = await engine.sync();
  ok("detached, nothing is sent", r.unattached === true && server.calls.length === 0);
  ok("...and the event is queued, on disk", engine.pendingCount === 1 && queuedOnDisk(storage).length === 1);
  ok("...and the reason is kept", engine.lastError === "handed_over");
}

group("I. The gate (SCRBRD-078): nothing goes out past a lease that is not this device's");
{
  const storage = memoryStorage(), server = fakeServer();
  let answer = { ok: false, reason: "token_moved" };
  let asked = 0;
  const gate = async () => { asked++; return answer; };
  const { engine, net } = unattached(storage, server, { gate });
  await engine.init();
  await engine.attach(3);
  net.online = false;
  await engine.record(OPEN); await engine.record(PAIR);
  net.online = true;
  const r = await engine.sync();
  ok("a refusing gate sends nothing and says why", r.blocked === "token_moved" && server.calls.length === 0 && engine.lastError === "token_moved", r);
  ok("...and marks nothing sent: an undo could still withdraw them", engine.isUnsent(OPEN.id) && engine.isUnsent(PAIR.id));
  // Its own lapsed lease, taken back under 4: the batch goes out under 4.
  answer = { ok: true, epoch: 4 };
  let epochs = null;
  engine.transport = async (m, batch) => { epochs = batch.map((e) => e.epoch); return server.transport(m, batch); };
  await engine.sync();
  ok("a gate that took the token back: the queue goes out under the new generation", JSON.stringify(epochs) === "[4,4]", epochs);
  ok("...and the device now holds 4", engine.epoch === 4 && storage._dump().get("meta:epoch") === "4");
  ok("the gate is asked before every flush", asked === 2);
}

group("J. The toss (SCRBRD-075): first, before any event, or nothing goes");
{
  const storage = memoryStorage(), server = fakeServer();
  const order = [];
  let settle = async () => ({ settled: false, reason: "toss_conflict" });
  const { engine, net } = unattached(storage, server, { settleToss: (t) => { order.push(`toss:${t.wonBy}/${t.decision}`); return settle(t); } });
  engine.transport = async (m, batch) => { order.push(...batch.map((e) => e.idempotencyKey)); return server.transport(m, batch); };
  await engine.init();
  net.online = false;
  await engine.queueToss({ wonBy: "away", decision: "bat" });
  await engine.record(OPEN);
  ok("the toss is on disk before anything is sent", JSON.parse(storage._dump().get("toss:pending")).wonBy === "away");
  // Restart with no signal: the toss survives.
  const again = unattached(storage, server, { settleToss: (t) => { order.push(`toss:${t.wonBy}/${t.decision}`); return settle(t); } });
  again.engine.transport = engine.transport;
  await again.engine.init();
  ok("...and survives a reload", again.engine.toss?.wonBy === "away" && again.engine.toss?.decision === "bat");
  await again.engine.attach(1);
  again.net.online = true;
  const r = await again.engine.sync();
  ok("a toss that does not settle: nothing after it is sent", r.blocked === "toss_conflict" && !order.includes(OPEN.id), order);
  ok("...and it stays queued, on disk", again.engine.toss != null && storage._dump().has("toss:pending"));
  settle = async () => ({ settled: true });
  await again.engine.sync();
  ok("settled: the toss goes first, then the events", order.at(-2) === "toss:away/bat" && order.at(-1) === OPEN.id, order);
  ok("...and leaves the queue and the disk", again.engine.toss === null && !storage._dump().has("toss:pending"));

  // A toss with no event behind it still goes.
  const s2 = memoryStorage(), sv2 = fakeServer();
  let sent = 0;
  const lone = unattached(s2, sv2, { settleToss: async () => { sent++; return { settled: true }; } }).engine;
  await lone.init(); await lone.attach(1);
  await lone.queueToss({ wonBy: "home", decision: "bowl" });
  await lone.sync();
  ok("a toss alone is sent, with nothing queued behind it", sent === 1 && lone.toss === null);

  // Set aside at a handover: it belongs to the log the pad gave up.
  const s3 = memoryStorage();
  const aside = unattached(s3, fakeServer()).engine;
  await aside.init();
  await aside.queueToss({ wonBy: "away", decision: "bowl" });
  const kept = await aside.setTossAside();
  ok("a toss set aside is handed back, and leaves the queue and the disk",
     kept?.wonBy === "away" && aside.toss === null && !s3._dump().has("toss:pending"));
  ok("...and with none queued there is nothing to hand back", (await aside.setTossAside()) === null);
}

group("K. Clearing a finished match's outbox (SCRBRD-079): never while anything waits");
{
  const storage = memoryStorage(), server = fakeServer();
  const { engine, net } = device(storage, server);
  await engine.init();
  for (const ev of [OPEN, PAIR]) await engine.record(ev);
  ok("refused while events are queued", (await engine.clearOutbox()) === false && queuedOnDisk(storage).length === 2);
  net.online = true;
  await engine.sync();
  engine.held.push({ ...engine.acked[0], state: "refused", reason: "x", idempotencyKey: "held:1" });
  ok("refused while an event is held for a person", (await engine.clearOutbox()) === false);
  engine.held.pop();
  engine.toss = { wonBy: "home", decision: "bat" };
  ok("refused while a toss is unsent", (await engine.clearOutbox()) === false);
  engine.toss = null;
  ok("before: sent markers on disk", keysOnDisk(storage, "sent:").length === 2);
  ok("with nothing waiting it clears", (await engine.clearOutbox()) === true && storage._dump().size === 0, [...storage._dump().keys()]);
  ok("...and still knows, this session, what it sent", engine.isKnown(OPEN.id) && !engine.isUnsent(OPEN.id));
  const noClear = new SyncEngine({ matchId: "m", deviceId: "dev", scorerId: "u", epoch: 1,
    storage: { ...memoryStorage(), clearMatch: undefined }, transport: server.transport });
  await noClear.init();
  ok("storage that cannot clear is left alone", (await noClear.clearOutbox()) === false);
  // A record in progress is waiting too.
  const s3 = memoryStorage();
  const slow = { ...s3, put: async (k, v) => { await tick(); await tick(); return s3.put(k, v); } };
  const e3 = new SyncEngine({ matchId: "m", deviceId: "dev", scorerId: "u", epoch: 1, storage: slow, transport: server.transport, isOnline: () => false });
  await e3.init();
  const recording = e3.record(run(2));
  ok("refused while a record is still writing", (await e3.clearOutbox()) === false);
  await recording;
}

group("L. markSent / isKnown: what the server has is never queued, never cut");
{
  const storage = memoryStorage(), server = fakeServer();
  const { engine } = unattached(storage, server);
  await engine.init();
  const S1 = run(3), S2 = run(4);
  ok("an id nothing has seen is not known", !engine.isKnown(S1.id));
  await engine.markSent([S1.id, S2.id]);
  ok("marked: known, and on disk", engine.isKnown(S1.id) && keysOnDisk(storage, "sent:").includes(`sent:${S1.id}`));
  const again = unattached(storage, server).engine;
  await again.init();
  ok("...across a reload", again.isKnown(S2.id));
  await again.record(OPEN);
  ok("a queued event is known", again.isKnown(OPEN.id));
}

console.log(`\n${"─".repeat(52)}\nSYNC ENGINE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
