/**
 * The exchange's rate limits (SCRBRD-140; the lead's review, 2026-10-02): the
 * per-address bucket is a whole school's behind one NAT address, so it is
 * sized for one, and the per-account bucket is one person's. The arithmetic
 * is in signin-api.mjs above EXCHANGE_RATE; this holds it, on a fake clock.
 * And the walk's signing key is never the default.
 */
import { EXCHANGE_RATE, UID_RATE, verifierFromEnv, TEST_PROJECT } from "./signin-api.mjs";
import { RateLimit } from "../public/public-api.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

group("The sizes");
ok("per address: 120 a minute, bursts of 40", EXCHANGE_RATE.perMinute === 120 && EXCHANGE_RATE.burst === 40);
ok("per Google account: 6 a minute, bursts of 6", UID_RATE.perMinute === 6 && UID_RATE.burst === 6);

group("A school of ~80 staff and ~100 pupils on Google, behind one address");
{
  let t = 0;
  const lim = new RateLimit(() => t, EXCHANGE_RATE);
  // Monday 07:30: all 80 staff open the app in the same moment, and each one
  // refused retries when the answer says to.
  let served = 0, firstRound = 0;
  /** @type {number[]} */
  let queue = Array.from({ length: 80 }, () => 0);
  let round = 0;
  while (queue.length && t < 120_000) {
    /** @type {number[]} */
    const next = [];
    for (let i = 0; i < queue.length; i++) {
      const w = lim.take("school");
      if (w === 0) { served++; if (round === 0) firstRound++; } else next.push(w);
    }
    queue = next;
    round++;
    if (queue.length) t += Math.min(...queue) * 1000;
  }
  ok("forty are in at once", firstRound === 40);
  ok("all eighty are in within twenty-one seconds", served === 80 && t <= 21_000);

  // The steady state: 180 clients, each re-exchanging once per thirty-minute
  // token, evenly spread — one every ten seconds, for an hour: never refused.
  const steady = new RateLimit(() => t, EXCHANGE_RATE);
  let steadyRefused = 0;
  for (let i = 0; i < 360; i++) { t += 10_000; if (steady.take("school")) steadyRefused++; }
  ok("an hour of ordinary re-exchanges is never refused", steadyRefused === 0);

  // One address hammering: the burst, then two a second, no more.
  const hammer = new RateLimit(() => t, EXCHANGE_RATE);
  let got = 0;
  for (let i = 0; i < 1000; i++) { if (hammer.take("x") === 0) got++; }
  t += 10_000;
  for (let i = 0; i < 1000; i++) { if (hammer.take("x") === 0) got++; }
  ok("a thousand at once and a thousand ten seconds later: 40, then 20", got === 60);
}

group("The walk's key is never the default");
{
  const real = verifierFromEnv({ env: {}, dev: true });
  ok("no FIREBASE_TEST_KEYS: Google's keys, for scrbrd-os", real.verifier.projectId === "scrbrd-os" && real.test === false);
  ok("with it in production: refused", (() => {
    try { verifierFromEnv({ env: { FIREBASE_TEST_KEYS: "/nonexistent" }, dev: false }); return false; }
    catch (/** @type {any} */ e) { return /Refusing to start/.test(e.message); }
  })());
  ok("with it for the real project: refused", (() => {
    try { verifierFromEnv({ env: { FIREBASE_TEST_KEYS: "/nonexistent", FIREBASE_TEST_PROJECT_ID: "scrbrd-os" }, dev: true }); return false; }
    catch (/** @type {any} */ e) { return /may not be the real project/.test(e.message); }
  })());
  ok("the test project is not the real one", String(TEST_PROJECT) !== "scrbrd-os");
}

console.log(`\n${"─".repeat(52)}\nSIGN-IN API SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
