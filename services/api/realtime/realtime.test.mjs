/**
 * Step 5 proof:
 *   A. MatchHub — fanout, unsubscribe, resilience, event/session broadcast,
 *      and commit-and-broadcast wiring.
 *   B. sessionRoutes — transitions run under principal and broadcast new state.
 *   C. MatchStream — the join/reconnect race: catch-up + live stream with NO
 *      missed and NO duplicated events; reconnect resumes from lastSeq.
 */
import { MatchHub, makeCommitAndBroadcast } from "./realtime.mjs";
import { sessionRoutes } from "./session-routes.mjs";
import { MatchStream } from "./live-client.mjs";
import { signToken } from "../auth/auth.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = t => console.log("\n" + t);
const SECRET = "step5-secret";
const bearer = (userId = "uS", deviceId = "devA") => `Bearer ${signToken({ userId, deviceId }, SECRET)}`;
const nextTick = () => new Promise(r => setTimeout(r, 0));

// ── A. Hub ──
group("A. Hub fanout + unsubscribe + resilience");
{
  const hub = new MatchHub();
  const a = [], b = [];
  const offA = hub.subscribe("m3", m => a.push(m));
  const offB = hub.subscribe("m3", m => b.push(m));
  hub.subscribe("m9", () => { throw new Error("other match"); }); // must not receive m3

  ok("room has 2 subscribers", hub.roomSize("m3") === 2);
  const n = hub.broadcastEvents("m3", [{ seq: 1, payload: {} }, { seq: 2, payload: {} }]);
  ok("delivered to both", n === 2 && a.length === 1 && b.length === 1);
  ok("broadcast carries uptoSeq", a[0].uptoSeq === 2 && a[0].type === "events");

  offA();
  ok("unsubscribe removes one", hub.roomSize("m3") === 1);
  hub.broadcastSession("m3", { state: "active", epoch: 1 });
  ok("remaining sub gets session msg", b[b.length - 1].type === "session" && b[b.length - 1].state === "active");
  ok("unsubscribed sub gets nothing more", a.length === 1);

  offB();
  ok("empty room is cleaned up", hub.roomSize("m3") === 0);
  ok("publish to empty room is safe", hub.publish("m3", { x: 1 }) === 0);

  // a throwing subscriber must not break the others
  const hub2 = new MatchHub();
  const got = [];
  hub2.subscribe("m", () => { throw new Error("bad socket"); });
  hub2.subscribe("m", m => got.push(m));
  const delivered = hub2.broadcastEvents("m", [{ seq: 1, payload: {} }]);
  ok("one bad subscriber doesn't block others", got.length === 1 && delivered === 1);
}

group("A. commit-and-broadcast wiring");
{
  const hub = new MatchHub();
  const seen = [];
  hub.subscribe("m3", m => seen.push(m));
  // fake appendEvents: accept everything, assign seq = clientSeq
  const fakeAppend = async (pool, sec, br, mid, events) => ({
    accepted: events.map(e => ({ idempotencyKey: e.idempotencyKey, seq: e.clientSeq })),
    duplicates: [], quarantined: [],
  });
  const commit = makeCommitAndBroadcast(fakeAppend, hub);
  const events = [
    { idempotencyKey: "d:1:1", clientSeq: 1, epoch: 1, innings: 0, payload: { kind: "ball", value: 4 } },
    { idempotencyKey: "d:1:2", clientSeq: 2, epoch: 1, innings: 0, payload: { kind: "ball", value: 6 } },
  ];
  await commit(null, null, bearer(), "m3", events);
  ok("committed balls broadcast with full payload", seen.length === 1 && seen[0].events.length === 2 && seen[0].events[0].payload.value === 4);
  ok("broadcast carries assigned seq", seen[0].events[1].seq === 2);
}

// ── B. Session routes broadcast transitions ──
group("B. Session routes run under principal and broadcast state");
{
  const hub = new MatchHub();
  const seen = [];
  hub.subscribe("m3", m => seen.push(m));

  // fake pool: scoring_claim returns ok, then the follow-up session read returns active
  const log = [];
  const client = {
    query: async (text, params) => {
      log.push(text.replace(/\s+/g, " ").trim());
      if (/scoring_claim\(/.test(text)) return { rows: [{ ok: true, reason: null, epoch: 1 }] };
      if (/from scoring_session where match_id/.test(text)) return { rows: [{ state: "active", epoch: 1, holder_user_id: "uS", holder_device: "devA" }] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = { connect: async () => client };
  const routes = sessionRoutes({ pool, secret: SECRET, hub });

  let sent = null;
  const res = { json: b => (sent = b), status: () => res };
  await routes.claim({ params: { id: "m3" }, headers: { authorization: bearer() }, body: { device: "devA" } }, res);
  ok("claim returns ok", sent.ok === true && sent.epoch === 1);
  ok("claim ran under a principal txn", log.includes("BEGIN") && log.includes("COMMIT"));
  ok("claim broadcast session state to watchers", seen.some(m => m.type === "session" && m.state === "active"));

  // heartbeat does NOT broadcast (no state change)
  const before = seen.length;
  const client2 = { query: async (t) => (/scoring_lease_check/.test(t)
    ? { rows: [{ found: true, holds: true, epoch: 1, state: "active" }] }
    : { rows: [] }), release() {} };
  const routes2 = sessionRoutes({ pool: { connect: async () => client2 }, secret: SECRET, hub });
  let hb = null;
  await routes2.heartbeat({ params: { id: "m3" }, headers: { authorization: bearer() }, body: { device: "devA", epoch: 1 } }, { json: b => (hb = b), status: () => ({ json: () => {} }) });
  ok("heartbeat ok", hb.ok === true);
  // The old handler ran a direct UPDATE on scoring_session, which has no UPDATE
  // policy — so it matched nothing and reported not_token_holder to a scorer
  // who held the token.
  ok("heartbeat goes through the lease function, not a raw UPDATE",
     hb.epoch === 1);
  ok("heartbeat does not broadcast", seen.length === before);
}

// ── C. The join/reconnect race ──
group("C. Joining mid-match: no missed, no duplicated events");
{
  // Controllable fake transport
  let handlers = null;
  const connect = h => { handlers = h; return () => { handlers = null; }; };
  // History source: everything up to seq 5 already happened
  const HISTORY = [1, 2, 3, 4, 5].map(seq => ({ seq, payload: { kind: "ball", type: "run", value: 1 } }));
  const fetchSince = async (mid, since) => HISTORY.filter(e => e.seq > since);

  const updates = [];
  const stream = new MatchStream({ matchId: "m3", connect, fetchSince, onUpdate: u => updates.push(u) });
  stream.start();

  // stream opens; BEFORE catch-up completes, two live events arrive (6,7)
  handlers.onOpen();                       // triggers async _catchUp()
  handlers.onMessage({ type: "events", events: [{ seq: 6, payload: { kind: "ball", type: "run", value: 4 } }] });
  handlers.onMessage({ type: "events", events: [{ seq: 7, payload: { kind: "ball", type: "run", value: 2 } }] });
  await nextTick();                        // let _catchUp resolve + flush buffer

  const sc = stream.score();
  ok("all 7 balls applied exactly once", stream.applied.size === 7 && stream.lastSeq === 7);
  ok("score = 5×1 + 4 + 2 = 11", sc.runs === 11 && sc.balls === 7);

  // a duplicate of an already-applied event changes nothing
  handlers.onMessage({ type: "events", events: [{ seq: 6, payload: { kind: "ball", type: "run", value: 4 } }] });
  ok("duplicate seq ignored", stream.applied.size === 7 && stream.score().runs === 11);

  // a gap (seq jumps to 10, missing 8,9) triggers a re-catch-up
  HISTORY.push({ seq: 8, payload: { kind: "ball", value: 1 } }, { seq: 9, payload: { kind: "ball", value: 1 } }, { seq: 10, payload: { kind: "ball", value: 1 } });
  handlers.onMessage({ type: "events", events: [{ seq: 10, payload: { kind: "ball", value: 1 } }] });
  await nextTick();
  ok("gap detected → caught up 8,9,10", stream.applied.size === 10 && stream.lastSeq === 10);
}

group("C. Reconnect resumes from lastSeq (no re-fetch of the whole match)");
{
  let handlers = null, sinceCalls = [];
  const connect = h => { handlers = h; return () => {}; };
  const HISTORY = Array.from({ length: 12 }, (_, i) => ({ seq: i + 1, payload: { kind: "ball", value: 1 } }));
  const fetchSince = async (mid, since) => { sinceCalls.push(since); return HISTORY.filter(e => e.seq > since); };

  const stream = new MatchStream({ matchId: "m3", connect, fetchSince });
  stream.start();
  handlers.onOpen(); await nextTick();
  ok("initial catch-up from seq 0", sinceCalls[0] === 0 && stream.lastSeq === 12);

  // drop the connection, then reconnect
  handlers.onClose();
  ok("backoff scheduled on close", stream.backoffMs > 0);
  // simulate the reconnect open (bypass timer)
  stream._open(); handlers.onOpen(); await nextTick();
  ok("reconnect catches up FROM lastSeq, not 0", sinceCalls[sinceCalls.length - 1] === 12);
  ok("no duplication after reconnect", stream.applied.size === 12);

  stream.stop();
  ok("stop() marks stopped", stream._stopped === true);
}

console.log(`\n${"─".repeat(52)}\nREALTIME SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
