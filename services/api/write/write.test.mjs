/**
 * Step 4 proof:
 *   A. server appendEvents — runs under principal txn, dedupes, allocates seq,
 *      quarantines stale-epoch, refreshes lease; refuses a different event
 *      under a used key, and an event the Laws do not allow, per event.
 *   B. client SyncEngine — DURABLE (survives a simulated crash), flushes in
 *      order, handles offline, optimistic score matches replay, checkpoints.
 */
import { appendEvents, readEvents } from "./events-api.mjs";
import { SyncEngine, memoryStorage } from "@scrbrd/sync";
import { signToken } from "../auth/auth.mjs";
/** @import { Transport } from "@scrbrd/sync" */

let pass = 0, fail = 0;
/** @type {(n: string, c: unknown, detail?: string) => void} — the detail is accepted and not printed */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
const SECRET = "step4-secret";
// The device is bound INTO the token, not sent alongside it: the ball_event
// INSERT policy compares device_id against the live lease, so a device named in
// a header would let a second device write under the first one's lease.
const bearer = (userId = "uScorer", deviceId = "devA") => `Bearer ${signToken({ userId, deviceId }, SECRET)}`;

// ── Fake Postgres tuned for the write path ──
// The log the match already has, as ball_event rows. By default an innings
// that is open and ready for a delivery — batters in, a bowler named — so the
// balls these tests send are ones the Laws allow, and each test is about what
// it names rather than about the Laws.
const OPENED = [
  { seq: 1, innings: 0, kind: "innings_start", idempotency_key: "o1", payload: { battingTeam: "HIL", bowlingTeam: "MHS", overs: 20 } },
  { seq: 2, innings: 0, kind: "batters", idempotency_key: "o2", payload: { striker: "p1", nonStriker: "p2" } },
  { seq: 3, innings: 0, kind: "bowler", idempotency_key: "o3", payload: { bowler: "b1" } },
];
// existingKeys: stored with the SAME fingerprint (a retry). conflictKeys:
// stored under that key with a DIFFERENT one.
/**
 * @param {object} [opts]
 * @param {any} [opts.session]           a scoring_session row, or none
 * @param {Set<string>} [opts.existingKeys]
 * @param {Set<string>} [opts.conflictKeys]
 * @param {any[]} [opts.log]             ball_event rows already stored
 * @param {number} [opts.maxSeq]
 */
function fakeDb({ session, existingKeys = new Set(), conflictKeys = new Set(), log: stored = OPENED, maxSeq = stored.length } = {}) {
  /** @type {{ text: string, params: any[] }[]} */
  const log = [];
  /** @type {any[][]} */
  const ballEvents = [];
  /** @type {any[][]} */
  const quarantine = [];
  let seq = maxSeq;
  const client = {
    query: async (/** @type {string} */ text, /** @type {any[]} */ params) => {
      log.push({ text: text.replace(/\s+/g, " ").trim(), params });
      const t = text;
      // The session row is read (and the lease refreshed) through
      // scoring_lease_check, not a direct SELECT ... FOR UPDATE — Postgres will
      // not lock a row the UPDATE policy does not admit, and scoring_session
      // deliberately has no UPDATE policy.
      if (/scoring_lease_check/.test(t)) {
        if (!session) return { rows: [{ found: false, holds: false, epoch: null, state: null }] };
        const holds = session.state === "active" && session.epoch === params[2]
                      && session.holder_device === params[1]
                      && new Date(session.lease_until) > new Date();
        return { rows: [{ found: true, holds, epoch: session.epoch, state: session.state }] };
      }
      if (/from ball_event where idempotency_key/.test(t))
        return { rows: existingKeys.has(params[0]) ? [{ seq: 1, same: true }]
                     : conflictKeys.has(params[0]) ? [{ seq: 1, same: false }] : [] };
      if (/from ball_event_quarantine where idempotency_key/.test(t)) return { rows: [] };
      if (/from ball_event where match_id = \$1 order by seq/.test(t)) return { rows: stored };
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
const ev = (/** @type {number} */ n, extra = {}) => ({ epoch: 3, deviceId: "devA", scorerId: "uScorer", clientSeq: n, clientTs: Date.now(),
  idempotencyKey: `devA:3:${n}`, innings: 0, payload: { kind: "ball", type: "run", value: n % 7 }, ...extra });

// ── A. Server ──
group("A0. A wicket names how the batter was out, from the closed list, or is refused");
{
  const db = fakeDb({ session: liveSession });
  const bad = ev(1, { payload: { kind: "ball", type: "W", value: 0, dismissal: "run away" } });
  /** @type {any} */            // whatever appendEvents threw
  let err = null;
  try { await appendEvents(db.pool, SECRET, bearer(), "m1", [ev(0), bad]); } catch (e) { err = e; }
  ok("an unknown dismissal is a 400", err?.status === 400 && err?.message === "dismissal_unknown", String(err?.message));
  ok("...naming the field and the value", err?.detail?.field === "dismissal" && err?.detail?.value === "run away");
  ok("...and nothing in the batch was written", db.ballEvents.length === 0);
  const db2 = fakeDb({ session: liveSession });
  const r = await appendEvents(db2.pool, SECRET, bearer(), "m1", [ev(1, { payload: { kind: "ball", type: "W", value: 0, dismissal: "Run Out" } })]);
  ok("a known spelling is accepted", r.accepted.length === 1);
  // The columns travel as one JSON object (the last parameter), the same
  // object the fingerprint is taken over.
  const stored = String(db2.ballEvents[0]?.[7] ?? "");
  ok("...and stored canonical", stored.includes('"run_out"') && !stored.includes("Run Out"));
}

group("A. appendEvents runs under a principal transaction");
{
  const db = fakeDb({ session: liveSession });
  const out = await appendEvents(db.pool, SECRET, bearer(), "m3", [ev(1), ev(2)]);
  const texts = db.log.map(l => l.text);
  ok("wrapped in BEGIN/COMMIT", texts.includes("BEGIN") && texts.includes("COMMIT"));
  ok("takes the session lock through scoring_lease_check",
     db.log.some(l => /scoring_lease_check/.test(l.text)));
  ok("sets app.role before writing", db.log.findIndex(l => l.text.includes("app.role")) < db.log.findIndex(l => /insert into ball_event/.test(l.text)));
  ok("2 events accepted", out.accepted.length === 2);
  ok("contiguous seq assigned after the log (4,5)", out.accepted[0].seq === 4 && out.accepted[1].seq === 5);
  // Once per request, inside the lock, rather than once per ball — and inside
  // scoring_lease_check, because the application role may not touch
  // scoring_session directly.
  ok("lease refreshed as part of taking the lock",
     db.log.filter(l => /scoring_lease_check/.test(l.text)).length === 1);
}

group("A. Idempotency — retried balls are not double-inserted");
{
  const db = fakeDb({ session: liveSession, existingKeys: new Set(["devA:3:1"]) });
  const out = await appendEvents(db.pool, SECRET, bearer(), "m3", [ev(1), ev(2)]);
  ok("known key → duplicate (not re-inserted)", out.duplicates.length === 1 && out.duplicates[0].idempotencyKey === "devA:3:1");
  ok("new key → accepted", out.accepted.length === 1 && out.accepted[0].idempotencyKey === "devA:3:2");
  ok("only ONE ball_event insert happened", db.ballEvents.length === 1);
}

group("A. The same key with a DIFFERENT event is a conflict, not a duplicate (db/36)");
{
  // It used to be answered "duplicate" and the new body dropped: the device
  // was told its ball was recorded, and the server kept a different one.
  const db = fakeDb({ session: liveSession, conflictKeys: new Set(["devA:3:1"]) });
  const out = await appendEvents(db.pool, SECRET, bearer(), "m3", [ev(1), ev(2)]);
  ok("a key stored with another body is reported as a conflict, with the stored seq",
     out.conflicts.length === 1 && out.conflicts[0].idempotencyKey === "devA:3:1"
     && out.conflicts[0].seq === 1 && out.conflicts[0].reason === "idempotency_conflict");
  ok("...not as a duplicate", out.duplicates.length === 0);
  ok("...and nothing was written for it; the next event still was",
     db.ballEvents.length === 1 && out.accepted[0]?.idempotencyKey === "devA:3:2");
  ok("the retry's fingerprint is asked of the SAME object the insert is built from",
     db.log.some(l => /ball_event_fingerprint\(jsonb_populate_record/.test(l.text)));
}

group("A. The Laws, per event: a refusal names the event and does not wedge the batch");
{
  const noInnings = fakeDb({ session: liveSession, log: [] });
  const o1 = await appendEvents(noInnings.pool, SECRET, bearer(), "m3", [ev(1)]);
  ok("a ball with no innings open is refused, with the reason",
     o1.refused.length === 1 && o1.refused[0].reason === "no_innings" && noInnings.ballEvents.length === 0);

  // A void of something that is not the latest event, between two legal
  // balls. The balls either side are accepted; the void is handed back.
  const db = fakeDb({ session: liveSession });
  const bad = ev(2, { payload: { kind: "void", target: "o2" } });
  const out = await appendEvents(db.pool, SECRET, bearer(), "m3", [ev(1), bad, ev(3)]);
  ok("the illegal event in the middle is refused by name",
     out.refused.length === 1 && out.refused[0].idempotencyKey === "devA:3:2" && out.refused[0].reason === "void_not_latest");
  ok("...and the legal events either side of it are written", out.accepted.length === 2 && db.ballEvents.length === 2);
  ok("the log is folded once for the request, not once per event",
     db.log.filter(l => /order by seq/.test(l.text) && !/seq >/.test(l.text)).length === 1);

  // The fold is extended as events are accepted: the seventh legal ball of a
  // batch is judged against the six before it, which ended the over.
  const over = fakeDb({ session: liveSession });
  const seven = [1, 2, 3, 4, 5, 6, 7].map(n => ev(n, { payload: { kind: "ball", type: "run", value: 0 } }));
  const o2 = await appendEvents(over.pool, SECRET, bearer(), "m3", seven);
  ok("six balls are accepted and the seventh, with no bowler named for the new over, is refused",
     o2.accepted.length === 6 && o2.refused.length === 1 && o2.refused[0].reason === "next_bowler");
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
  try { await appendEvents(db.pool, SECRET, bearer(), "m3", []); } catch (/** @type {any} */ e) { threw = e.status === 400; }
  ok("empty batch rejected", threw);
  await readEvents(db.pool, SECRET, bearer("uSpectator"), "m3", 5);
  ok("readEvents queries since seq under principal",
     db.log.some(l => /seq > \$2/.test(l.text)) && db.log.some(l => l.text.includes("app.user_id")));
}

// ── A. One identity per event ──
group("A. The queue dedupes on the event's OWN id");
{
  // No transport: this group only records, and never syncs.
  const e = new SyncEngine(/** @type {any} */ ({ matchId: "m3", deviceId: "devA", scorerId: "u1", epoch: 3, storage: memoryStorage() }));
  const withId = await e.record({ kind: "ball", type: "run", value: 4, id: "devA:m3:xyz:1" });
  ok("an event that knows its id keeps it", withId.idempotencyKey === "devA:m3:xyz:1");
  // Two identities for one event is how a correction ends up pointing at
  // nothing: a void names the id, the server returns the key.
  ok("...so the void target and the dedupe key are the same string",
     withId.idempotencyKey === withId.payload.id);

  const anon = await e.record({ kind: "ball", type: "run", value: 1 });
  ok("an event with no id still gets a unique key",
     anon.idempotencyKey === "devA:3:2" && anon.idempotencyKey !== withId.idempotencyKey);
}

// ── B. Client durable queue ──
group("B. Durability — the queue survives a crash mid-over");
{
  const storage = memoryStorage();
  /** @type {number[]} */
  const sent = [];
  /** @type {Transport} */
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
  /** @type {Transport} */
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

group("B. Lost response — the server took the balls, the device never heard");
{
  // The worst network on a school ground is not "down"; it is "the request
  // got through and the answer did not". The server has the over; the device
  // still thinks it does not. What must not happen next is the over twice.
  const storage = memoryStorage();
  const serverHas = new Map();                    // idempotencyKey → seq, what Postgres would hold
  let calls = 0, acceptedTotal = 0;
  /** @type {Transport} */
  const transport = async (mid, batch) => {
    calls++;
    /** @type {{ idempotencyKey: string, seq: number }[]} */
    const accepted = [], duplicates = [];
    for (const e of batch) {
      if (serverHas.has(e.idempotencyKey)) duplicates.push({ idempotencyKey: e.idempotencyKey, seq: serverHas.get(e.idempotencyKey) });
      else { serverHas.set(e.idempotencyKey, serverHas.size + 1); accepted.push({ idempotencyKey: e.idempotencyKey, seq: serverHas.size }); }
    }
    acceptedTotal += accepted.length;
    if (calls === 1) throw new Error("socket hang up");     // processed, then the response is lost
    return { accepted, duplicates };
  };
  const e = new SyncEngine({ matchId: "m3", deviceId: "devA", scorerId: "uS", epoch: 3, storage, transport, isOnline: () => false });
  await e.init();
  for (let i = 0; i < 3; i++) await e.record({ kind: "ball", type: "run", value: 1 });
  e.isOnline = () => true;
  await e.sync();                                                 // the server stored 3; the device heard nothing
  ok("the server holds the balls", serverHas.size === 3);
  ok("the device still holds them as pending", e.pendingCount === 3);
  const r = await e.sync();                                       // the retry
  ok("the retry is answered as duplicates and settles", r.remaining === 0 && e.pendingCount === 0);
  ok("the server holds each ball ONCE", serverHas.size === 3 && acceptedTotal === 3);
  ok("storage cleared after the duplicate acks", (await storage.list("evt:")).length === 0);
  ok("the optimistic score counts each ball once", e.score().runs === 3);
}

group("B. Stale-epoch server response → moved to rejected, not lost silently");
{
  const storage = memoryStorage();
  /** @type {Transport} */
  const transport = async (mid, batch) => ({ quarantined: batch.map(e => ({ idempotencyKey: e.idempotencyKey, reason: "stale_epoch" })) });
  const e = new SyncEngine({ matchId: "m3", deviceId: "devA", scorerId: "uS", epoch: 3, storage, transport, isOnline: () => true });
  await e.init();
  await e.record({ kind: "ball", type: "run", value: 4 });
  await e.sync();
  ok("quarantined server-side → rejected list", e.rejected.length === 1 && e.rejected[0].reason === "stale_epoch");
  ok("removed from pending + storage", e.pendingCount === 0 && (await storage.list("evt:")).length === 0);
}

group("B. Refused and conflicting events are HELD for a person — not acked, not resent, not lost");
{
  const storage = memoryStorage();
  let calls = 0;
  /** @type {Transport} */
  const transport = async (mid, batch) => {
    calls++;
    return {
      accepted: [{ idempotencyKey: batch[0].idempotencyKey, seq: 1 }],
      refused: [{ idempotencyKey: batch[1].idempotencyKey, reason: "consecutive_overs" }],
      conflicts: [{ idempotencyKey: batch[2].idempotencyKey, seq: 7, reason: "idempotency_conflict" }],
    };
  };
  const e = new SyncEngine({ matchId: "m3", deviceId: "devA", scorerId: "uS", epoch: 3, storage, transport, isOnline: () => false });
  await e.init();
  /** @type {import("@scrbrd/sync").OutboxStatus | null} */
  let seen = null;
  e.onChange = (st) => { seen = st; };
  for (let i = 0; i < 3; i++) await e.record({ kind: "ball", type: "run", value: 1 });
  e.isOnline = () => true;
  const r = await e.sync();
  ok("the accepted one is acked", e.acked.length === 1 && r.flushed === 1);
  ok("the refused and the conflicting one are held, with their reasons",
     e.held.length === 2 && e.held[0].state === "refused" && e.held[0].reason === "consecutive_overs"
     && e.held[1].state === "conflict" && e.held[1].reason === "idempotency_conflict");
  ok("...neither is acked (the server has no copy of either)", !e.acked.some(a => e.held.some(h => h.idempotencyKey === a.idempotencyKey)));
  ok("...neither is left pending to be resent forever", e.pendingCount === 0 && e.safeToHandOver === true);
  // Widened back: onChange assigned it, and the checker does not follow a callback.
  ok("...and the scorer is told how many", /** @type {import("@scrbrd/sync").OutboxStatus | null} */ (seen)?.heldCount === 2);
  await e.sync();
  ok("a later sync does not send them again", calls === 1);
  ok("they are on disk, under their own prefix", (await storage.list("held:")).length === 2 && (await storage.list("evt:")).length === 0);

  const again = new SyncEngine({ matchId: "m3", deviceId: "devA", scorerId: "uS", epoch: 3, storage, transport, isOnline: () => false });
  const rec = await again.init();
  ok("a restart keeps them held and does not queue them", again.held.length === 2 && rec.recovered === 0 && again.pendingCount === 0);
  ok("a person can let one go", await again.discardHeld(again.held[0].idempotencyKey) === true
     && again.held.length === 1 && (await storage.list("held:")).length === 1);
  ok("the optimistic score counts only what the server kept", e.score().runs === 1);
}

group("B. Optimistic score matches replay + checkpoints");
{
  const storage = memoryStorage();
  /** @type {Transport} */
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
