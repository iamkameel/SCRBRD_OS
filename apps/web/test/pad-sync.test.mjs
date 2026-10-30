/**
 * The pad's connection to the server, driven in node with a fake server
 * behind PadSync.call (the match-day audit; Kameel's decisions of 30 Oct 2026).
 *
 *   B1  the heartbeat: an attached pad tells the server it is still scoring,
 *       with no ball to send, and stops in words when the token has moved
 *   P1  a toss queued with no signal, sent after the sign-in has run out,
 *       goes under the resume credential — not "sign in to send the toss"
 *   P6  an outbox that cannot open is said, not swallowed
 *   P7  a result declared while the pad had balls to send: they go to the
 *       lead's review, not nowhere
 *
 * The browser walk (tools/smoke-browser-takeover.mjs) drives the real pad;
 * the server's half is db/99 §102 and tools/smoke-pad-resume.mjs B.
 *
 *   node apps/web/test/pad-sync.test.mjs
 */
const disk = new Map();
const ls = {};
for (const [k, f] of Object.entries({
  getItem: (key) => (disk.has(key) ? disk.get(key) : null),
  setItem: (key, v) => { disk.set(key, String(v)); },
  removeItem: (key) => { disk.delete(key); },
})) Object.defineProperty(ls, k, { value: f, enumerable: false });
globalThis.localStorage = ls;
globalThis.fetch = async () => { throw new Error("no network in this suite: every request goes through the fake call()"); };

const { PadSync } = await import("../src/lib/sync.js");
const { bannerFor } = await import("../src/scorer/syncBanner.jsx").catch(() => ({ bannerFor: null }));
const { SyncEngine, memoryStorage } = await import("@scrbrd/sync");
const { inningsStart, ball, BALL_TYPE } = await import("@scrbrd/scoring");

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const MATCH = "77777777-0000-0000-0000-000000000002";
const hooks = (into = {}) => ({
  padLog: () => into.log ?? [[], []],
  adopt: () => true,
  restore: () => {},
  followToss: () => {},
  onStatus: (s) => { into.status = s; },
});

/**
 * A PadSync with an outbox on a memory store, attached under `epoch`, and a
 * fake server: `routes(method, path, body)` answers each call, and every call
 * is recorded.
 */
async function padWith({ epoch = 3, attached = true, pad = undefined, routes, net = { online: true } }) {
  const seen = {};
  const ps = new PadSync({ matchId: MATCH, userId: "u1", intent: "open", hooks: hooks(seen) });
  const calls = [];
  ps.call = async (path, opts = {}) => {
    const method = opts.method ?? "GET";
    calls.push({ method, path: path.replace(`/api/matches/${MATCH}`, ""), body: opts.body });
    return routes(method, path.replace(`/api/matches/${MATCH}`, ""), opts.body);
  };
  ps.pad = pad;
  const engine = new SyncEngine({
    matchId: MATCH, deviceId: "dev-a", scorerId: "u1", epoch: attached ? epoch : null, innings: 0,
    storage: memoryStorage(), isOnline: () => net.online,
    transport: (id, batch) => ps.send(id, batch),
    gate: () => ps.gate(),
    settleToss: (t) => ps.settleToss(t),
    onChange: () => ps.status(),
  });
  await engine.init();
  ps.engine = engine;
  if (attached) { await engine.attach(epoch); ps.leaseAt = Date.now(); }
  return { ps, engine, calls, seen };
}
const ev = (payload) => ({ ...payload, id: `ev-${Math.random().toString(36).slice(2)}` });

group("P1. A toss queued with no signal, sent after the sign-in ran out: under the resume credential");
{
  const tossRow = { current: null };
  const { ps, engine, calls } = await padWith({
    pad: { credential: "pad-cred" },   // the resume credential; nobody is signed in
    routes: (m, p, body) => {
      if (p === "/toss" && m === "GET") return { toss: tossRow.current };
      if (p === "/events" && m === "GET") return { events: [], quarantined: 0 };
      if (p === "/toss" && m === "POST") { tossRow.current = { toss_won_by: body.wonBy, toss_decision: body.decision }; return { wonBy: body.wonBy, decision: body.decision }; }
      if (p === "/events" && m === "POST") return { accepted: body.events.map((e, i) => ({ idempotencyKey: e.idempotencyKey, seq: i + 1 })) };
      throw new Error(`unexpected ${m} ${p}`);
    },
  });
  await engine.queueToss({ wonBy: "away", decision: "bowl" });
  await engine.record(ev(inningsStart({ innings: 0, battingTeam: "Home", bowlingTeam: "Away", squad: [], overs: 20 })));
  await engine.record(ev(ball({ type: BALL_TYPE.RUN, value: 1 })));
  const r = await engine.sync();
  const post = calls.find((c) => c.method === "POST" && c.path === "/toss");
  ok("the toss is written through the pad's own door (call(): the credential), signed out", !!post && post.body?.wonBy === "away" && post.body?.decision === "bowl", calls);
  ok("...not refused as toss_needs_sign_in", engine.lastError !== "toss_needs_sign_in" && ps.reason !== "toss_needs_sign_in", { lastError: engine.lastError, reason: ps.reason });
  ok("...and the balls behind it go out after it", r.flushed === 2 && engine.pendingCount === 0 && !engine.toss, r);
  ok("...the toss before the first event", calls.findIndex((c) => c.method === "POST" && c.path === "/toss") < calls.findIndex((c) => c.method === "POST" && c.path === "/events"), calls.map((c) => `${c.method} ${c.path}`));
}
{
  // Neither a credential nor a sign-in: the pad still asks for a sign-in.
  const { ps, engine, calls } = await padWith({
    pad: null,
    routes: (m, p) => {
      if (p === "/toss" && m === "GET") return { toss: null };
      if (p === "/events" && m === "GET") return { events: [], quarantined: 0 };
      throw new Error(`unexpected ${m} ${p}`);
    },
  });
  await engine.queueToss({ wonBy: "home", decision: "bat" });
  await engine.sync();
  ok("no credential and nobody signed in: sign in to send the toss, nothing written", engine.lastError === "toss_needs_sign_in"
     && !calls.some((c) => c.method === "POST"), { lastError: engine.lastError, calls });
  void ps;
}
{
  // The token moved under the credential between the read and the write.
  const { ps, engine } = await padWith({
    pad: { credential: "pad-cred" },
    routes: (m, p) => {
      if (p === "/toss" && m === "GET") return { toss: null };
      if (p === "/events" && m === "GET") return { events: [], quarantined: 0 };
      if (p === "/toss" && m === "POST") throw Object.assign(new Error("token_moved"), { name: "ApiError", status: 403, code: "token_moved" });
      throw new Error(`unexpected ${m} ${p}`);
    },
  });
  await engine.queueToss({ wonBy: "home", decision: "bat" });
  await engine.sync();
  ok("the server says the token moved: the pad stops, in words, and keeps the toss", ps.reason === "token_moved" && ps.halted && !!engine.toss && !engine.attached, { reason: ps.reason });
}

group("B1. The heartbeat: the lease kept with nothing to send, and a moved token said");
{
  let hb = { ok: true, epoch: 3, state: "active", reason: null };
  const { ps, engine, calls } = await padWith({
    routes: (m, p) => {
      if (p === "/session/heartbeat") return hb;
      throw new Error(`unexpected ${m} ${p}`);
    },
  });
  ps.leaseAt = 0;
  ok("the pad has a heartbeat", typeof ps.heartbeat === "function");
  if (typeof ps.heartbeat !== "function") ps.heartbeat = async () => {};
  await ps.heartbeat();
  ok("an attached pad with nothing queued tells the server it is still scoring", calls.filter((c) => c.path === "/session/heartbeat").length === 1
     && calls[0].body?.epoch === 3, calls);
  ok("...and trusts its lease again", Date.now() - ps.leaseAt < 2000);
  const n = calls.length;
  await ps.heartbeat();
  ok("a beat just after a refresh is skipped", calls.length === n);
  hb = { ok: false, epoch: 4, state: "active", reason: "not_token_holder" };
  await ps.heartbeat({ now: true });
  ok("another device holds the token: the pad stops, token_moved, nothing claimed", ps.reason === "token_moved" && ps.halted && !engine.attached
     && !calls.some((c) => c.path === "/session/claim"), { reason: ps.reason, calls: calls.map((c) => c.path) });
  const m = calls.length;
  await ps.heartbeat({ now: true });
  ok("a halted pad does not beat", calls.length === m);
  ps.stop();
}
{
  // Its own lapsed lease (the generation has not moved): taken back by the beat.
  const { ps, engine, calls } = await padWith({
    routes: (m, p) => {
      if (p === "/session/heartbeat") return { ok: false, epoch: 3, state: "active", reason: "not_token_holder" };
      if (p === "/session/claim") return { ok: true, epoch: 4 };
      throw new Error(`unexpected ${m} ${p}`);
    },
  });
  if (typeof ps.heartbeat !== "function") ps.heartbeat = async () => {};
  await ps.heartbeat({ now: true });
  ok("its own lapsed lease: the beat takes it back, under the next generation", engine.attached && engine.epoch === 4
     && calls.some((c) => c.path === "/session/claim" && !c.body?.takeover), calls);
  ps.stop();
}

group("P7. A result declared while the pad had balls to send: they go to the lead's review");
{
  const posted = [];
  const net = { online: false };   // the balls were recorded with no signal
  const { ps, engine, seen } = await padWith({ net,
    routes: (m, p, body) => {
      if (p === "/session/heartbeat") return { ok: false, epoch: 3, state: null, reason: "match_complete" };
      if (p === "/events" && m === "POST") {
        posted.push(...body.events);
        return { quarantined: body.events.map((e) => ({ idempotencyKey: e.idempotencyKey, reason: "match_complete" })) };
      }
      throw new Error(`unexpected ${m} ${p}`);
    },
  });
  await engine.record(ev(ball({ type: BALL_TYPE.RUN, value: 2 })));
  await engine.record(ev(ball({ type: BALL_TYPE.RUN, value: 1 })));
  net.online = true;
  ps.leaseAt = 0;
  await engine.sync();
  await (ps.reviewing ?? Promise.resolve());
  ok("the pad stops as match_complete", ps.reason === "match_complete" && ps.halted && !engine.attached, ps.reason);
  ok("...and its two balls are sent, as stamped, for review", posted.length === 2 && posted.every((e) => e.epoch === 3), posted.map((e) => e.epoch));
  ok("...the server filed them for review; nothing is left on the phone with no road", engine.pendingCount === 0 && engine.rejected.length === 2
     && engine.rejected.every((e) => e.reason === "match_complete"), { pending: engine.pendingCount, rejected: engine.rejected.length });
  ok("...and the pad says For review 2", seen.status?.rejected === 2, seen.status?.rejected);
}
{
  // No signal at that moment: kept, said, and offered again.
  let reach = false;
  const net = { online: false };
  const { ps, engine, seen } = await padWith({ net,
    routes: (m, p, body) => {
      if (p === "/session/heartbeat") return { ok: false, epoch: 3, state: null, reason: "match_complete" };
      if (p === "/events" && m === "POST") {
        if (!reach) throw Object.assign(new TypeError("Failed to fetch"));
        return { quarantined: body.events.map((e) => ({ idempotencyKey: e.idempotencyKey, reason: "match_complete" })) };
      }
      throw new Error(`unexpected ${m} ${p}`);
    },
  });
  await engine.record(ev(ball({ type: BALL_TYPE.RUN, value: 4 })));
  net.online = true;
  ps.leaseAt = 0;
  await engine.sync();
  await (ps.reviewing ?? Promise.resolve());
  ok("no answer: the ball stays queued, and why is kept", engine.pendingCount === 1 && ps.reviewError === "unreachable", { pending: engine.pendingCount, why: ps.reviewError });
  const say = bannerFor?.(seen.status, null, 0, { describe: () => "Ball — 4 runs" });
  ok("...the banner lists it and offers Send for review", say?.action === "review" && say?.list?.length === 1 && /never sent before the result/.test(say?.text ?? ""), say);
  reach = true;
  await ps.forReview?.();
  ok("...and Send for review sends it", engine.pendingCount === 0 && engine.rejected.length === 1, { pending: engine.pendingCount });
}

group("P6. An outbox that cannot open is said, not swallowed");
{
  // No IndexedDB here, so the outbox's storage cannot open: init() rejects,
  // exactly as a storage fault on a phone would.
  const seen = {};
  const ps = new PadSync({ matchId: MATCH, userId: "u1", intent: "open", hooks: hooks(seen) });
  let threw = null, engine = "unset";
  try { engine = await ps.open(); } catch (e) { threw = e; }
  ok("open() does not throw into the void", threw === null, threw?.message);
  ok("...it answers no outbox", engine === null && ps.engine === null);
  ok("...and the pad is told, in a status the banner reads", seen.status?.outboxUnavailable === true && seen.status?.open === false, seen.status);
  const say = bannerFor?.(seen.status, null);
  ok("...\"This phone cannot queue balls to send\", and to score on the other phone",
     say?.reason === "outbox_unavailable" && /cannot queue balls to send/.test(say.lead) && /Score on the other phone/.test(say.text), say);
  ps.attach("open");
  ok("...and nothing tries to attach behind it", ps.attaching === null || ps.attaching === undefined);
  ps.stop();
}

console.log(`\n${"─".repeat(52)}\nPAD SYNC: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
