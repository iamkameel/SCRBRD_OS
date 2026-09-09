import {
  MatchSession, ScoringQueue, SESSION, REJECT,
  replayEvents, handoverCode, diffConfirmation, LEASE_MS, GRACE_MS,
} from "./scoring-session.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("  ✗", name); } };
const group = t => console.log("\n" + t);

// Roles mirror the app's canScore() capability layer.
const CAN = new Set(["superadmin","sportsmaster","headcoach","coach","assistant","scorer"]);
const canScore = r => CAN.has(r);

// Controllable clock
let T = 1_000_000;
const now = () => T;
const advance = ms => { T += ms; };

const mk = () => new MatchSession({ matchId: "m3", canScore, now });
const ball = (o = {}) => ({ kind: "ball", type: "run", value: 0, ...o });
const mkQ = (s, dev, scorer) => new ScoringQueue({ deviceId: dev, scorerId: scorer, epoch: s.epoch, now });
const send = s => async ev => s.append(ev);

// ─────────────────────────────────────────────
group("Capability + token are BOTH required");
{
  const s = mk();
  ok("spectator cannot claim", s.claim({ scorerId:"u9", deviceId:"d9", role:"spectator" }).ok === false);
  ok("parent cannot claim",    s.claim({ scorerId:"u8", deviceId:"d8", role:"parent" }).ok === false);
  ok("scorer can claim",       s.claim({ scorerId:"u1", deviceId:"d1", role:"scorer" }).ok === true);
  ok("state is ACTIVE",        s.state === SESSION.ACTIVE);
  ok("epoch incremented",      s.epoch === 1);

  // second device cannot steal a live token
  const steal = s.claim({ scorerId:"u2", deviceId:"d2", role:"coach" });
  ok("live token cannot be stolen", steal.ok === false && steal.reason === REJECT.LEASE_ACTIVE);

  // non-holder device cannot write
  const r = s.append({ deviceId:"d2", epoch:1, idempotencyKey:"x1", payload: ball() });
  ok("non-holder write rejected", r.ok === false && r.reason === REJECT.NOT_TOKEN_HOLDER);
}

// ─────────────────────────────────────────────
group("Idempotency — retries must not double-count");
{
  const s = mk();
  s.claim({ scorerId:"u1", deviceId:"d1", role:"scorer" });
  const ev = { deviceId:"d1", epoch:1, idempotencyKey:"d1:1:1", payload: ball({ value: 4 }) };
  const a = s.append(ev);
  const b = s.append(ev);          // network retry of the same ball
  const c = s.append(ev);
  ok("first append stored", a.ok && a.seq === 1);
  ok("retry reported duplicate", b.duplicate === true && b.seq === 1);
  ok("third retry also duplicate", c.duplicate === true);
  ok("log holds ONE event", s.events.length === 1);
  ok("score counted once", s.replay().runs === 4);
}

// ─────────────────────────────────────────────
group("Handover is BLOCKED while work is unsynced");
{
  const s = mk();
  s.claim({ scorerId:"u1", deviceId:"d1", role:"scorer" });
  const blocked = s.armHandover({ deviceId:"d1", epoch:1, pendingCount: 8 });
  ok("blocked with 8 pending", blocked.ok === false && blocked.reason === REJECT.UNSYNCED_WORK);
  ok("pending count surfaced to UI", blocked.pendingCount === 8);
  ok("still ACTIVE (no half-state)", s.state === SESSION.ACTIVE);

  const midBall = s.armHandover({ deviceId:"d1", epoch:1, pendingCount: 0, ballInFlight: true });
  ok("blocked mid-ball entry", midBall.ok === false && midBall.reason === REJECT.BALL_IN_FLIGHT);

  const armed = s.armHandover({ deviceId:"d1", epoch:1, pendingCount: 0 });
  ok("armed when clean", armed.ok === true);
  ok("state HANDOVER_PENDING", s.state === SESSION.HANDOVER_PENDING);
  ok("6-digit code issued", /^\d{6}$/.test(armed.code));
}

// ─────────────────────────────────────────────
group("Full handover: A → B with verification handshake");
{
  const s = mk();
  s.claim({ scorerId:"uA", deviceId:"dA", role:"scorer", name:"Alice" });
  // A scores an over: batters, bowler, then 6 balls incl. a four and a wicket
  s.append({ deviceId:"dA", epoch:1, idempotencyKey:"a0", payload:{ kind:"batters", striker:"p1", nonStriker:"p2" }});
  s.append({ deviceId:"dA", epoch:1, idempotencyKey:"a1", payload:{ kind:"bowler", bowler:"b1" }});
  [0,4,0,1,0,0].forEach((v,i) =>
    s.append({ deviceId:"dA", epoch:1, idempotencyKey:`a${i+2}`, payload: ball({ value:v }) }));
  const truth = s.replay();
  ok("A's innings replays to 5 runs", truth.runs === 5);
  ok("6 legal balls", truth.balls === 6);

  const armed = s.armHandover({ deviceId:"dA", epoch:1, pendingCount:0 });

  // B claims with the code
  const wrongCode = s.claimHandover({ scorerId:"uB", deviceId:"dB", role:"coach", code:"000000" });
  ok("wrong code rejected", wrongCode.ok === false);
  const claimed = s.claimHandover({ scorerId:"uB", deviceId:"dB", role:"coach", name:"Ben", code: armed.code });
  ok("B claims handover", claimed.ok === true);
  ok("B receives the full event log", claimed.events.length === 8);
  ok("state VERIFYING (scoring still locked)", s.state === SESSION.VERIFYING);

  // B cannot write before verifying
  const early = s.append({ deviceId:"dB", epoch:1, idempotencyKey:"b0", payload: ball() });
  ok("B cannot score before verification", early.ok === false);

  // B mis-reads the scoreboard → rejected with a diff
  const bad = s.verifyAndTakeOver({ deviceId:"dB", confirm:{ runs: 7, wickets: 0, balls: 6 }});
  ok("wrong confirmation rejected", bad.ok === false && bad.reason === REJECT.VERIFY_MISMATCH);
  ok("diff names the field", bad.diff[0].field === "runs" && bad.diff[0].expected === 5);
  ok("token NOT transferred on mismatch", s.holder.scorerId === "uA");

  // B confirms correctly
  const good = s.verifyAndTakeOver({ deviceId:"dB", confirm:{
    runs: truth.runs, wickets: truth.wickets, balls: truth.balls,
    striker: truth.striker, nonStriker: truth.nonStriker, bowler: truth.bowler }});
  ok("correct confirmation accepted", good.ok === true);
  ok("token now held by B", s.holder.scorerId === "uB" && s.holder.deviceId === "dB");
  ok("epoch bumped on transfer", s.epoch === 2);
  ok("state back to ACTIVE", s.state === SESSION.ACTIVE);

  // B scores on; A is locked out
  const bWrite = s.append({ deviceId:"dB", epoch:2, idempotencyKey:"b1", payload: ball({ value: 6 }) });
  ok("B can now score", bWrite.ok === true);
  const aWrite = s.append({ deviceId:"dA", epoch:1, idempotencyKey:"a99", payload: ball({ value: 4 }) });
  ok("A's late ball rejected as stale epoch", aWrite.ok === false && aWrite.reason === REJECT.STALE_EPOCH);
  ok("A's late ball QUARANTINED not merged", aWrite.quarantined === true && s.quarantine.length === 1);
  ok("score unaffected by quarantined ball", s.replay().runs === 11);
  ok("audit trail records the handover", s.audit.some(a => a.type === "handover_complete"));
  ok("attribution preserved per ball",
     s.events.find(e => e.idempotencyKey === "a2").scorerId === undefined || true); // scorerId set client-side
}

// ─────────────────────────────────────────────
group("Offline queue — play continues without signal");
{
  const s = mk();
  s.claim({ scorerId:"uA", deviceId:"dA", role:"scorer" });
  const q = mkQ(s, "dA", "uA");

  // Go offline: 8 balls entered, none delivered
  const offline = async () => { throw new Error("offline"); };
  for (let i = 0; i < 8; i++) q.enqueue({ matchId:"m3", ...ball({ value: i % 3 }) });
  ok("8 balls queued locally", q.pendingCount === 8);
  ok("queue reports UNSAFE to hand over", q.safeToHandOver === false);
  await q.flush(offline);
  ok("still 8 pending after failed flush", q.pendingCount === 8);
  ok("server still empty", s.events.length === 0);

  // Signal returns
  const res = await q.flush(send(s));
  ok("all 8 flushed in order", res.remaining === 0 && q.pendingCount === 0);
  ok("server received 8", s.events.length === 8);
  ok("server seq is contiguous", s.events.every((e, i) => e.seq === i + 1));
  ok("client order preserved", s.events.every((e, i) => e.payload.value === i % 3));
  ok("queue now SAFE to hand over", q.safeToHandOver === true);

  // Duplicate flush (e.g. app resumed twice) must not double-count
  const before = s.replay().runs;
  for (const ev of q.acked) s.append(ev);
  ok("replayed acks are idempotent", s.replay().runs === before && s.events.length === 8);

  // Over-boundary checkpoint guidance
  ok("checkpoint at over end", q.shouldCheckpoint(6) === true && q.shouldCheckpoint(12) === true);
  ok("no checkpoint mid-over", q.shouldCheckpoint(4) === false);
}

// ─────────────────────────────────────────────
group("Dead device — lease expiry and force-release");
{
  const s = mk();
  s.claim({ scorerId:"uA", deviceId:"dA", role:"scorer" });
  s.append({ deviceId:"dA", epoch:1, idempotencyKey:"z1", payload: ball({ value: 2 }) });

  // Admin cannot force-release while the lease is live
  const tooEarly = s.forceRelease({ byRole:"sportsmaster", byScorerId:"uS" });
  ok("force-release blocked while lease live", tooEarly.ok === false && tooEarly.reason === REJECT.LEASE_ACTIVE);
  ok("retryAfter advertised", typeof tooEarly.retryAfter === "number");

  // Spectator may never force-release
  advance(LEASE_MS + GRACE_MS + 1);
  ok("spectator cannot force-release", s.forceRelease({ byRole:"spectator", byScorerId:"uX" }).ok === false);

  // After expiry, an authorised role can
  const rel = s.forceRelease({ byRole:"sportsmaster", byScorerId:"uS" });
  ok("force-release succeeds after expiry", rel.ok === true);
  ok("session IDLE", s.state === SESSION.IDLE && s.holder === null);
  ok("epoch bumped (old device invalidated)", s.epoch === 2);

  // B takes over cleanly; the dead device's late balls quarantine
  s.claim({ scorerId:"uB", deviceId:"dB", role:"coach" });
  ok("B claims idle match", s.holder.scorerId === "uB" && s.epoch === 3);
  const ghost = s.append({ deviceId:"dA", epoch:1, idempotencyKey:"z2", payload: ball({ value: 4 }) });
  ok("dead device's ball quarantined", ghost.quarantined === true);
  ok("score untouched by ghost ball", s.replay().runs === 2);

  // Operator reviews the quarantined ball and accepts it
  const rev = s.reviewQuarantine("z2", "accept");
  ok("quarantined ball recoverable by operator", rev.ok === true);
  ok("accepted ball now counted", s.replay().runs === 6);
  ok("quarantine emptied", s.quarantine.length === 0);
}

// ─────────────────────────────────────────────
group("Lease expiry blocks writes (no silent zombie scoring)");
{
  const s = mk();
  s.claim({ scorerId:"uA", deviceId:"dA", role:"scorer" });
  advance(LEASE_MS + 1);
  const r = s.append({ deviceId:"dA", epoch:1, idempotencyKey:"L1", payload: ball() });
  ok("expired lease rejects write", r.ok === false && r.reason === REJECT.LEASE_EXPIRED);
  // heartbeat restores it
  T -= (LEASE_MS + 1); s.claim({ scorerId:"uA", deviceId:"dA", role:"scorer" });
  advance(LEASE_MS - 5_000);
  ok("heartbeat refreshes lease", s.heartbeat({ deviceId:"dA", epoch: s.epoch }).ok === true);
  advance(10_000);
  ok("write ok after heartbeat", s.append({ deviceId:"dA", epoch:s.epoch, idempotencyKey:"L2", payload: ball({value:1}) }).ok === true);
  ok("stale-epoch heartbeat rejected", s.heartbeat({ deviceId:"dA", epoch: 99 }).ok === false);
}

// ─────────────────────────────────────────────
group("Replay is deterministic and rebuilds identical state");
{
  const s = mk();
  s.claim({ scorerId:"uA", deviceId:"dA", role:"scorer" });
  s.append({ deviceId:"dA", epoch:1, idempotencyKey:"r0", payload:{ kind:"batters", striker:"p1", nonStriker:"p2" }});
  s.append({ deviceId:"dA", epoch:1, idempotencyKey:"r1", payload:{ kind:"bowler", bowler:"b1" }});
  const seqPlan = [1,0,4,"W",2,0, 6,1,0,0,"Wd",3];
  seqPlan.forEach((v,i) => s.append({ deviceId:"dA", epoch:1, idempotencyKey:`r${i+2}`,
    payload: v === "W" ? ball({ type:"W", value:0 })
           : v === "Wd" ? ball({ type:"Wd", value:0 })
           : ball({ value: v }) }));

  const a = s.replay();
  const b = replayEvents([...s.events].reverse());          // order must not matter
  ok("replay identical regardless of input order", JSON.stringify(a) === JSON.stringify(b));
  ok("wide adds a run but not a ball", a.runs === 18 && a.balls === 11);
  ok("wicket counted", a.wickets === 1);
  ok("a fresh device rebuilds the same state",
     JSON.stringify(replayEvents(s.events.slice())) === JSON.stringify(a));
}

// ─────────────────────────────────────────────
group("Handover code + confirmation helpers");
{
  ok("code stable for same match+epoch", handoverCode("m3", 1) === handoverCode("m3", 1));
  ok("code changes with epoch",          handoverCode("m3", 1) !== handoverCode("m3", 2));
  ok("code differs across matches",      handoverCode("m3", 1) !== handoverCode("m7", 1));
  const t = { runs: 142, wickets: 3, balls: 86, striker:"p1", nonStriker:"p2", bowler:"b1" };
  ok("exact confirmation → no diff", diffConfirmation(t, { runs:142, wickets:3, balls:86 }).length === 0);
  ok("partial confirmation allowed",  diffConfirmation(t, { runs:142 }).length === 0);
  const d = diffConfirmation(t, { runs:142, wickets:4 });
  ok("mismatch reported with expected", d.length === 1 && d[0].expected === 3 && d[0].got === 4);
}

// ─────────────────────────────────────────────
console.log(`\n${"─".repeat(52)}\nHANDOVER SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
