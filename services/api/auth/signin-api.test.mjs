/**
 * The exchange's rate limits (SCRBRD-140; the lead's review, 2026-10-02): the
 * per-address bucket is a whole school's behind one NAT address, so it is
 * sized for one, and the per-account bucket is one person's. The arithmetic
 * is in signin-api.mjs above EXCHANGE_RATE; this holds it, on a fake clock.
 * And the walk's signing key is never the default. And the account routes
 * (account lifecycle slice 2, db/90): disable and enable pass the reason to
 * account_set_active() as it came, the preview passes the counts and nothing
 * else, and every refusal goes out with its sentence.
 */
import { EXCHANGE_RATE, UID_RATE, verifierFromEnv, TEST_PROJECT, signInRoutes, SIGN_IN_REFUSALS } from "./signin-api.mjs";
import { RateLimit } from "../public/public-api.mjs";
import { signToken } from "./auth.mjs";

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

group("Disable, enable and the preview (account lifecycle slice 2, db/90)");
{
  const SECRET = "signin-test-secret";
  const ID = "88888888-0000-0000-0000-000000000006";
  const bearer = `Bearer ${signToken({ userId: "88888888-0000-0000-0000-00000000000c", deviceId: "devA",
                                       sessionId: "5e551011-0000-4000-8000-000000000001", epoch: 0 }, SECRET)}`;
  /** A pool whose one connection answers `answer(text)` and records every statement. @param {(t: string) => any} answer */
  const fake = (answer) => {
    /** @type {{ text: string, params: any }[]} */
    const log = [];
    const client = { query: async (/** @type {string} */ text, /** @type {any} */ params) => {
      log.push({ text, params });
      return { rows: answer(text) ?? [] };
    }, release: () => {} };
    return { log, pool: /** @type {any} */ ({ connect: async () => client, query: client.query }) };
  };
  /** Run one route; answer { status, body }. */
  const call = async (/** @type {any} */ pool, /** @type {string} */ name, /** @type {any} */ req) => {
    const routes = /** @type {any} */ (signInRoutes({ pool, secret: SECRET, verifier: /** @type {any} */ ({}) }));
    let status = 200, body = null;
    const res = { status: (/** @type {number} */ s) => { status = s; return res; }, json: (/** @type {any} */ b) => { body = b; return res; } };
    await routes[name]({ headers: { authorization: bearer }, params: { id: ID }, ...req }, res);
    return { status, body: /** @type {any} */ (body) };
  };
  const setCall = (/** @type {any[]} */ log) => log.find((l) => l.text.includes("account_set_active"));

  let f = fake((q) => q.includes("account_set_active") ? [{ ok: true, reason: null, active: false }] : []);
  let r = await call(f.pool, "disable", { body: { reason: "Phone lost at the ground" } });
  ok("disable asks account_set_active(id, false, reason), the reason as it came",
     setCall(f.log)?.text.includes("account_set_active($1, $2, $3)")
     && JSON.stringify(setCall(f.log)?.params) === JSON.stringify([ID, false, "Phone lost at the ground"]));
  ok("...and answers 200 { active: false }", r.status === 200 && r.body?.active === false && !("ok" in r.body));
  f = fake((q) => q.includes("account_set_active") ? [{ ok: true, reason: null, active: true }] : []);
  r = await call(f.pool, "enable", { body: { reason: "  Phone recovered  " } });
  ok("enable asks account_set_active(id, true, reason), untrimmed: the database trims and checks it",
     JSON.stringify(setCall(f.log)?.params) === JSON.stringify([ID, true, "  Phone recovered  "]) && r.body?.active === true);
  f = fake((q) => q.includes("account_set_active") ? [{ ok: false, reason: "reason_required", active: null }] : []);
  r = await call(f.pool, "disable", { body: { reason: 42 } });
  ok("a reason that is not text goes as null", setCall(f.log)?.params?.[2] === null);
  ok("reason_required: 422, in words", r.status === 422 && r.body?.error === "reason_required"
     && /at least ten characters/.test(r.body?.detail ?? ""));
  f = fake(() => []);
  r = await call(f.pool, "enable", {});
  ok("no body at all: the reason goes as null, and the database decides", setCall(f.log)?.params?.[2] === null && r.status === 409);
  for (const [code, status] of /** @type {[string, number][]} */ ([["reason_too_long", 422], ["not_permitted", 403],
                                                                   ["superadmin_only", 403], ["cannot_disable_yourself", 403]])) {
    f = fake((q) => q.includes("account_set_active") ? [{ ok: false, reason: code, active: null }] : []);
    r = await call(f.pool, "disable", { body: { reason: "Phone lost at the ground" } });
    ok(`${code}: ${status}, with its sentence`, r.status === status && r.body?.error === code && r.body?.detail === SIGN_IN_REFUSALS[code][1]);
  }
  f = fake(() => []);
  r = await call(f.pool, "disable", { params: { id: "not-a-uuid" }, body: { reason: "Phone lost at the ground" } });
  ok("an id that is not one: 404, and nothing asked", r.status === 404 && !setCall(f.log));

  f = fake((q) => q.includes("account_offboard_preview")
    ? [{ ok: true, reason: null, active: true, sessions: 2, pad_credentials: 1, scoring_tokens: ["Hilton College 1XI v Kearsney 1XI · 10 Oct 2026"],
         duties: 3, lifts: 1, children: 2 }] : []);
  r = await call(f.pool, "preview", {});
  ok("the preview asks account_offboard_preview(id)",
     f.log.some((l) => l.text.includes("account_offboard_preview($1)") && JSON.stringify(l.params) === JSON.stringify([ID])));
  ok("...and answers the counts and the fixtures, and nothing more",
     r.status === 200 && JSON.stringify(r.body) === JSON.stringify({ active: true, sessions: 2, padCredentials: 1,
       scoringTokens: ["Hilton College 1XI v Kearsney 1XI · 10 Oct 2026"], duties: 3, lifts: 1, children: 2 }));
  for (const [code, status] of /** @type {[string, number][]} */ ([["not_permitted", 403], ["other_school", 403], ["cannot_disable_yourself", 403]])) {
    f = fake((q) => q.includes("account_offboard_preview")
      ? [{ ok: false, reason: code, active: null, sessions: null, pad_credentials: null, scoring_tokens: null, duties: null, lifts: null, children: null }] : []);
    r = await call(f.pool, "preview", {});
    ok(`a refused preview (${code}): ${status}, its sentence, no counts`,
       r.status === status && r.body?.error === code && r.body?.detail === SIGN_IN_REFUSALS[code][1]
       && JSON.stringify(Object.keys(r.body ?? {}).sort()) === JSON.stringify(["detail", "error"]));
  }

  // D21: a dead token is told the same for every reason.
  f = fake((q) => { if (q.includes("app_session_begin")) throw Object.assign(new Error("session_revoked"), { code: "28000" }); return []; });
  r = await call(f.pool, "disable", { body: { reason: "Phone lost at the ground" } });
  ok("a revoked session: 401 session_revoked, \"You were signed out. Sign in again.\"",
     r.status === 401 && r.body?.error === "session_revoked" && r.body?.detail === "You were signed out. Sign in again." && !setCall(f.log));
  ok("the words: reason_required, reason_too_long, other_school, session_revoked",
     SIGN_IN_REFUSALS.reason_required?.[0] === 422 && SIGN_IN_REFUSALS.reason_too_long?.[0] === 422
     && SIGN_IN_REFUSALS.other_school?.[1] === "Also holds roles at another school. This account cannot be disabled from here."
     && SIGN_IN_REFUSALS.session_revoked?.[0] === 401);
  ok("no sentence repeats a reason or names an account",
     Object.values(SIGN_IN_REFUSALS).every(([, w]) => !/\{|\$|@/.test(w)));
}

console.log(`\n${"─".repeat(52)}\nSIGN-IN API SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
