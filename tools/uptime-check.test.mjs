#!/usr/bin/env node
/**
 * tools/uptime-check.mjs: what counts as down, how long it waits, and which
 * issue action each outcome takes. No network, no gh.
 *
 *   node tools/uptime-check.test.mjs
 */
import { judge, healthUrl, round, check, decide, act, findOpen, issueTitle } from "./uptime-check.mjs";

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
const good = JSON.stringify({ ok: true, db: "ok" });
const res = (status, text) => async () => ({ status, text: async () => text });
const noSleep = async () => {};

group("What counts as healthy");
ok("200, ok, db ok", judge(200, good).ok);
ok("no answer is down", !judge(0, "").ok);
ok("503 is down", !judge(503, "").ok && /503/.test(judge(503, "").reason));
ok("not JSON is down", !judge(200, "<html>").ok);
ok("db not ok is down", !judge(200, JSON.stringify({ ok: true, db: "down" })).ok);
ok("ok false is down", !judge(200, JSON.stringify({ ok: false, db: "ok" })).ok);
ok("failed audit writes are down", !judge(200, JSON.stringify({ ok: true, db: "ok", audit_failed: 2 })).ok);
ok("audit_failed 0 is fine", judge(200, JSON.stringify({ ok: true, db: "ok", audit_failed: 0 })).ok);

group("The address");
ok("a base gets the path", healthUrl("https://x.onrender.com/") === "https://x.onrender.com/api/health");
ok("a full health URL is kept", healthUrl("https://x.onrender.com/api/health") === "https://x.onrender.com/api/health");

group("A sleeping server gets its retry");
{
  let calls = 0;
  const f = async () => { calls++; return calls === 1 ? { status: 502, text: async () => "" } : { status: 200, text: async () => good }; };
  const r = await round({ url: "u", attempts: 2, fetchFn: f, sleep: noSleep });
  ok("a 502 then a 200 is up", r.ok && calls === 2);
  let t = 0;
  const hang = async (_u, { signal }) => { t++; ok("each try carries a timeout signal", signal instanceof AbortSignal); throw new Error("timeout"); };
  const d = await round({ url: "u", attempts: 2, fetchFn: hang, sleep: noSleep });
  ok("two timeouts are a failed round", !d.ok && t === 2);
}

group("Down means two rounds in a row");
{
  let calls = 0;
  const f = async () => { calls++; return calls <= 2 ? { status: 503, text: async () => "" } : { status: 200, text: async () => good }; };
  const r = await check({ url: "u", attempts: 2, rounds: 2, fetchFn: f, sleep: noSleep });
  ok("a failed first round and a passing second is up", r.ok && r.rounds === 2);
  const bad = await check({ url: "u", attempts: 2, rounds: 2, fetchFn: res(500, ""), sleep: noSleep });
  ok("both rounds failing is down", !bad.ok && bad.rounds === 2);
  const slept = [];
  await check({ url: "u", attempts: 1, rounds: 2, roundPauseMs: 777, fetchFn: res(500, ""), sleep: async (ms) => { slept.push(ms); } });
  ok("it pauses between rounds, not after the last", slept.length === 1 && slept[0] === 777);
}

group("The issue");
ok("down, none open: create", decide({ ok: false, open: null }) === "create");
ok("down, one open: comment, not a second issue", decide({ ok: false, open: 7 }) === "comment");
ok("up, one open: close", decide({ ok: true, open: 7 }) === "close");
ok("up, none open: nothing", decide({ ok: true, open: null }) === "none");
ok("the title is the one asked for", issueTitle("prod") === "Uptime: prod is down");
{
  const calls = [];
  const gh = (a) => { calls.push(a); return "[]"; };
  act("create", { env: "demo", reason: "answered HTTP 503, not 200" }, gh);
  ok("create passes the title", calls[0].includes("Uptime: demo is down") && calls[0][1] === "create");
  act("comment", { env: "demo", open: 12, reason: "x" }, gh);
  ok("comment names the open issue", calls[1][1] === "comment" && calls[1][2] === "12");
  act("close", { env: "demo", open: 12 }, gh);
  ok("close names the open issue", calls[2][1] === "close" && calls[2][2] === "12");
  const list = JSON.stringify([{ number: 3, title: "Uptime: prod is down again" }, { number: 4, title: "Uptime: prod is down" }]);
  ok("only the exact title matches", findOpen("prod", () => list) === 4);
  ok("another env's issue is not matched", findOpen("demo", () => list) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
