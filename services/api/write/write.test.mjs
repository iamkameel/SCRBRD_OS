/**
 * Step 4 proof:
 *   A. server appendEvents — runs under principal txn, dedupes, allocates seq,
 *      quarantines stale-epoch, refreshes lease.
 *   B. client SyncEngine — DURABLE (survives a simulated crash), flushes in
 *      order, handles offline, optimistic score matches replay, checkpoints.
 */
import { appendEvents, readEvents } from "./events-api.mjs";
import { SyncEngine, memoryStorage } from "./sync-engine.mjs";
import { signToken } from "../auth/auth.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = t => console.log("\n" + t);
const SECRET = "step4-secret";
// The device is bound INTO the token, not sent alongside it: the ball_event
// INSERT policy compares device_id against the live lease, so a device named in
// a header would let a second device write under the first one's lease.
const bearer = (userId = "uScorer", deviceId = "devA") => `Bearer ${signToken({ userId, deviceId }, SECRET)}`;

// ── Fake Postgres tuned for the write path ──
function fakeDb({ session, existingKeys = new Set(), maxSeq = 0 } = {}) {
  const log = [];
  const ballEvents = [];
  const quarantine = [];
  let seq = maxSeq;
  const client = {
    query: async (text, params) => {
      log.push({ text: text.replace(/\s+/g, " ").trim(), params });
      const t = text;
      if (/for update/.test(t)) return { rows: session ? [session] : [] };
      if (/from ball_event where idempotency_key/.test(t))
        return { rows: existingKeys.has(params[0]) ? [{ seq: 1 }] : [] };
      if (/coalesce\(max\(seq\)/.test(t)) return { rows: [{ next: seq + 1 }] };
      if (/insert into ball_event_quarantine/.test(t)) { quarantine.push(params); return { rows: [] }; }
      if (/insert into ball_event/.test(t)) { seq = params[1]; ballEvents.push(params); return { rows: [] }; }
      if (/from ball_event where match_id = \$1 and seq >/.test(t)) return { rows: ballEvents.map((_, i) => ({ seq: i + 1 })) };
      return { rows: [] };            // BEGIN/COMMIT/set_config/update
    },
    release() { client.released = true; },
    released: false,
  };
  return { pool: { connect: async () => client }, client, log, ballEvents, quarantine };
}
const liveSession = { epoch: 3, state: "active", holder_user_id: "uScorer", holder_device: "devA", lease_until: new Date(Date.now() + 60000) };
const ev = (n, extra = {}) => ({ epoch: 3, deviceId: "devA", scorerId: "uScorer", clientSeq: n, clientTs: Date.now(),
  idempotencyKey: `devA:3:${n}`, innings: 0, payload: { kind: "ball", type: "run", value: n % 7 }, ...extra });

// ── A. Server ──
group("A. appendEvents runs under a principal transaction");
{
  const db = fakeDb({ session: liveSession });
  const out = await appendEvents(db.pool, SECRET, bearer(), "m3", [ev(1), ev(2)]);
  const texts = db.log.map(l => l.text);
  ok("wrapped in BEGIN/COMMIT", texts.includes("BEGIN") && texts.includes("COMMIT"));
  ok("locks the session row (serialised writes)", db.log.some(l => /for update/.test(l.text)));
  ok("sets app.role before writing", db.log.findIndex(l => l.text.includes("app.role")) < db.log.findIndex(l => /insert into ball_event/.test(l.text)));
  ok("2 events accepted", out.accepted.length === 2);
  ok("contiguous seq assigned (1,2)", out.accepted[0].seq === 1 && out.accepted[1].seq === 2);
  ok("lease refreshed after write", db.log.some(l => /update scoring_session set lease_until/.test(l.text)));
}

group("A. Idempotency — retried balls are not double-inserted");
{
  const db = fakeDb({ session: liveSession, existingKeys: new Set(["devA:3:1"]) });
  const out = await appendEvents(db.pool, SECRET, bearer(), "m3", [ev(1), ev(2)]);
  ok("known key → duplicate (not re-inserted)", out.duplicates.length === 1 && out.duplicates[0].idempotencyKey === "devA:3:1");
  ok("new key → accepted", out.accepted.length === 1 && out.accepted[0].idempotencyKey === "devA:3:2");
  ok("only ONE ball_event insert happened", db.ballEvents.length === 1);
}

group("A. Stale epoch → QUARANTINE, never merged");
{
  const db = fakeDb({ session: { ...liveSession, epoch: 5 } });   // token moved on
  const out = await appendEvents(db.pool, SECRET, bearer(), "m3", [ev(1) /* epoch 3 */]);
  ok("stale-epoch event quarantined", out.quarantined.length === 1 && out.quarantined[0].reason === "stale_epoch_or_lease");
  ok("nothing inserted into ball_event", db.ballEvents.length === 0);
  ok("row written to quarantine table", db.quarantine.length === 1);
}

group("A. Wrong device / expired lease → quarantined");
{
  const wrongDev = fakeDb({ session: { ...liveSession, holder_device: "devOther" } });
  const o1 = await appendEvents(wrongDev.pool, SECRET, bearer(), "m3", [ev(1)]);
  ok("non-holder device quarantined", o1.quarantined.length === 1 && wrongDev.ballEvents.length === 0);

  const expired = fakeDb({ session: { ...liveSession, lease_until: new Date(Date.now() - 1000) } });
  const o2 = await appendEvents(expired.pool, SECRET, bearer(), "m3", [ev(1)]);
  ok("expired lease quarantined", o2.quarantined.length === 1 && expired.ballEvents.length === 0);

  const noSession = fakeDb({ session: null });
  const o3 = await appendEvents(noSession.pool, SECRET, bearer(), "m3", [ev(1)]);
  ok("no session → quarantined with reason", o3.quarantined[0].reason === "no_session");
}

group("A. Empty / read");
{
  const db = fakeDb({ session: liveSession });
  let threw = false;
  try { await appendEvents(db.pool, SECRET, bearer(), "m3", []); } catch (e) { threw = e.status === 400; }
  ok("empty batch rejected", threw);
  await readEvents(db.pool, SECRET, bearer("uSpectator"), "m3", 5);
  ok("readEvents queries since seq under principal",
     db.log.some(l => /seq > \$2/.test(l.text)) && db.log.some(l => l.text.includes("app.user_id")));
}

// ── B. Client durable queue ──
group("B. Durability — the queue survives a crash mid-over");
{
  const storage = memoryStorage();
  const sent = [];
  const transport = async (mid, batch) => { sent.push(batch.length); return { accepted: batch.map(e => ({ idempotencyKey: e.idempotencyKey, seq: e.clientSeq })) }; };

  // Score 4 balls OFFLINE (no sync)
  let e1 = new SyncEngine({ matchId: "m3", deviceId: "devA", scorerId: "uS", epoch: 3, storage, transport, isOnline: () => false });
  await e1.init();
  for (let i = 0; i < 4; i++) await e1.record({ kind: "ball", type: "run", value: 1 });
  ok("4 balls pending, none sent (offline)", e1.pendingCount === 4 && sent.length === 0);
  ok("all 4 persisted to storage", (await storage.list("evt:")).length === 4);
  ok("UNSAFE to hand over with pending", e1.safeToHandOver === false);

  // ---- CRASH ---- new engine instance, same storage (app restart)
  const e2 = new SyncEngine({ matchId: "m3", deviceId: "devA", scorerId: "uS", epoch: 3, storage, transport, isOnline: () => true });
  const rec = await e2.init();
  ok("recovered 4 balls after restart", rec.recovered === 4 && e2.pendingCount === 4);
  ok("clientSeq continues (no key collision)", e2.clientSeq === 4);

  // Back online → flush
  const r = await e2.sync();
  ok("all 4 flushed in one ordered batch", r.flushed === 4 && sent[sent.length - 1] === 4);
  ok("storage cleared after ack", (await storage.list("evt:")).length === 0);
  ok("SAFE to hand over once synced", e2.safeToHandOver === true);

  // A ball recorded after recovery keeps a unique key
  const ev5 = await e2.record({ kind: "ball", type: "run", value: 2 });
  ok("post-recovery key is unique", ev5.idempotencyKey === "devA:3:5");
}

group("B. Ordered flush, retry, and partial acks");
{
  const storage = memoryStorage();
  let calls = 0;
  const transport = async (mid, batch) => {
    calls++;
    if (calls === 1) throw new Error("offline");                 // first attempt fails
    // second attempt: ack all
    return { accepted: batch.map(e => ({ idempotencyKey: e.idempotencyKey, seq: e.clientSeq })) };
  };
  // Record offline (no auto-sync), then drive the two attempts deterministically.
  const e = new SyncEngine({ matchId: "m3", deviceId: "devA", scorerId: "uS", epoch: 3, storage, transport, isOnline: () => false });
  await e.init();
  for (let i = 0; i < 3; i++) await e.record({ kind: "ball", type: "run", value: 1 });
  e.isOnline = () => true;
  await e.sync();                                                 // attempt 1 → throws
  ok("failed sync keeps items pending", e.pendingCount === 3);
  ok("backoff advances on failure", e.backoffMs > 0);
  const r = await e.sync();                                       // attempt 2 → acks all
  ok("retry flushes everything", r.remaining === 0 && e.pendingCount === 0);
  ok("backoff resets after success", e.backoffMs === 0);
}

group("B. Stale-epoch server response → moved to rejected, not lost silently");
{
  const storage = memoryStorage();
  const transport = async (mid, batch) => ({ quarantined: batch.map(e => ({ idempotencyKey: e.idempotencyKey, reason: "stale_epoch" })) });
  const e = new SyncEngine({ matchId: "m3", deviceId: "devA", scorerId: "uS", epoch: 3, storage, transport, isOnline: () => true });
  await e.init();
  await e.record({ kind: "ball", type: "run", value: 4 });
  await e.sync();
  ok("quarantined server-side → rejected list", e.rejected.length === 1 && e.rejected[0].reason === "stale_epoch");
  ok("removed from pending + storage", e.pendingCount === 0 && (await storage.list("evt:")).length === 0);
}

group("B. Optimistic score matches replay + checkpoints");
{
  const storage = memoryStorage();
  const transport = async (mid, batch) => ({ accepted: batch.map(e => ({ idempotencyKey: e.idempotencyKey, seq: e.clientSeq })) });
  const e = new SyncEngine({ matchId: "m3", deviceId: "devA", scorerId: "uS", epoch: 3, storage, transport, isOnline: () => false });
  await e.init();
  await e.record({ kind: "batters", striker: "p1", nonStriker: "p2" });
  await e.record({ kind: "bowler", bowler: "b1" });
  for (const v of [1, 4, 0, 6, 2, 1]) await e.record({ kind: "ball", type: "run", value: v });
  const sc = e.score();
  ok("optimistic score = 14 off the bat", sc.runs === 14);
  ok("6 legal balls counted", sc.balls === 6);
  ok("checkpoint fires at over boundary", e.shouldCheckpoint(6) === true && e.shouldCheckpoint(4) === false);

  // sync then score again — must be identical (acked path replays the same)
  e.isOnline = () => true;
  await e.sync();
  const sc2 = e.score();
  ok("score identical after sync (acked replay)", sc2.runs === 14 && sc2.balls === 6);
}

console.log(`\n${"─".repeat(52)}\nWRITE-PATH SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
