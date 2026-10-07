/**
 * A keyed write is one transaction (GA-I01): write/replay.mjs over
 * runAsUnit() in auth/auth-db.mjs.
 *
 * No Postgres here — tools/smoke-idempotency.mjs is the live proof (eight
 * copies at once, a changed body, a real crash). This pins the SQL the unit
 * issues and its order: one connection, one BEGIN and one COMMIT, the
 * handler's calls as savepoints inside it, the receipt before the COMMIT,
 * and nothing committed for a replay, a refusal or a 5xx.
 */
import { runAsPrincipal, runAsUnit, afterCommit } from "../auth/auth-db.mjs";
import { signToken } from "../auth/auth.mjs";
import { canonical, fingerprint, keyedWrite } from "./replay.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {string} [d] */
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
const SECRET = "replay-test-secret";
const BEARER = `Bearer ${signToken({ userId: "00000000-0000-0000-0000-0000000000a1", deviceId: "dev-a", sessionId: "5e551011-0000-4000-8000-000000000001", epoch: 0 }, SECRET)}`;
const OTHER = `Bearer ${signToken({ userId: "00000000-0000-0000-0000-0000000000b2", deviceId: "dev-b", sessionId: "5e551011-0000-4000-8000-000000000002", epoch: 0 }, SECRET)}`;

/**
 * A pool whose connections log every statement. `seen` is the receipt the
 * lookup finds; `failOn` makes a statement matching it throw.
 * @param {{ seen?: any, failOn?: RegExp }} [o]
 */
const fakePool = ({ seen = null, failOn } = {}) => {
  /** @type {string[]} */
  const log = [];
  let connects = 0;
  const client = {
    /** @param {string} text */
    async query(text) {
      const t = text.replace(/\s+/g, " ").trim();
      log.push(t);
      await new Promise((r) => setImmediate(r));
      if (failOn && failOn.test(t)) throw Object.assign(new Error("refused"), { code: "42501" });
      if (/current_setting\('lock_timeout'\)/.test(t)) return { rows: [{ v: "0" }] };
      if (/from request_replay/.test(t)) return { rows: seen ? [seen] : [] };
      return { rows: [] };
    },
    release() {},
  };
  return { log, get connects() { return connects; }, pool: /** @type {any} */ ({ async connect() { connects++; return client; } }) };
};
const idx = (/** @type {string[]} */ log, /** @type {RegExp} */ re) => log.findIndex((l) => re.test(l));
const count = (/** @type {string[]} */ log, /** @type {RegExp} */ re) => log.filter((l) => re.test(l)).length;

group("The fingerprint is of the request, not its spelling");
{
  ok("keys in any order are the same JSON", canonical({ b: 1, a: { d: 2, c: 3 } }) === canonical({ a: { c: 3, d: 2 }, b: 1 }));
  ok("a list keeps its order", canonical([1, 2]) !== canonical([2, 1]));
  ok("an undefined field is no field", canonical({ a: 1, b: undefined }) === canonical({ a: 1 }));
  const base = { route: "POST /api/news", query: {}, body: { title: "Away day", scope: "team" } };
  ok("the same request, the same fingerprint", fingerprint(base) === fingerprint({ ...base, body: { scope: "team", title: "Away day" } }));
  ok("a changed body changes it", fingerprint(base) !== fingerprint({ ...base, body: { ...base.body, title: "Away day!" } }));
  ok("another route changes it", fingerprint(base) !== fingerprint({ ...base, route: "POST /api/news/x/withdraw" }));
  ok("the query is part of it", fingerprint(base) !== fingerprint({ ...base, query: { dry: "1" } }));
}

group("A handler's calls join the unit: one connection, one COMMIT, savepoints inside");
{
  const f = fakePool();
  const out = await runAsUnit(f.pool, SECRET, BEARER, async (c, _p, unit) => {
    const a = await runAsPrincipal(f.pool, SECRET, BEARER, async (cc) => { await cc.query("insert into news_post values (1)"); return "a"; });
    await unit.close();
    await c.query("insert into request_replay values (1)");
    return { commit: true, value: a };
  });
  ok("the call's value comes back", out === "a");
  ok("one connection, not two", f.connects === 1, String(f.connects));
  ok("one BEGIN, one COMMIT", count(f.log, /^BEGIN$/) === 1 && count(f.log, /^COMMIT$/) === 1, f.log.join(" | "));
  ok("the write is inside a savepoint", idx(f.log, /^SAVEPOINT unit_call_1$/) < idx(f.log, /insert into news_post/)
     && idx(f.log, /insert into news_post/) < idx(f.log, /^RELEASE SAVEPOINT unit_call_1$/));
  ok("deferred checks fire before the release, and the mode is put back",
     idx(f.log, /insert into news_post/) < idx(f.log, /SET CONSTRAINTS ALL IMMEDIATE/)
     && idx(f.log, /SET CONSTRAINTS ALL IMMEDIATE/) < idx(f.log, /SET CONSTRAINTS ALL DEFERRED/)
     && idx(f.log, /SET CONSTRAINTS ALL DEFERRED/) < idx(f.log, /RELEASE SAVEPOINT/));
  ok("the receipt is written before the one COMMIT", idx(f.log, /insert into request_replay/) < idx(f.log, /^COMMIT$/));
}

group("A refused call rolls back to its savepoint; the handler answers it; the unit goes on");
{
  const f = fakePool({ failOn: /insert into news_post/ });
  /** @type {any} */
  let caught = null;
  await runAsUnit(f.pool, SECRET, BEARER, async (c, _p, unit) => {
    try { await runAsPrincipal(f.pool, SECRET, BEARER, async (cc) => cc.query("insert into news_post values (1)")); }
    catch (e) { caught = e; }
    await unit.close();
    await c.query("insert into request_replay values (1)");
    return { commit: true, value: null };
  });
  ok("the handler sees the refusal", caught?.code === "42501");
  ok("...rolled back to the savepoint, not the whole unit", count(f.log, /^ROLLBACK TO SAVEPOINT unit_call_1$/) === 1 && count(f.log, /^ROLLBACK$/) === 0);
  ok("...and the unit still commits its answer", count(f.log, /^COMMIT$/) === 1);
}

group("Another person's call, inside the unit, is its own transaction");
{
  const f = fakePool();
  await runAsUnit(f.pool, SECRET, BEARER, async () => {
    await runAsPrincipal(f.pool, SECRET, OTHER, async (cc) => cc.query("select 1"));
    return { commit: true, value: null };
  });
  ok("a second connection, a second BEGIN/COMMIT", f.connects === 2 && count(f.log, /^BEGIN$/) === 2 && count(f.log, /^COMMIT$/) === 2);
}

group("Two calls side by side queue, rather than interleave on one connection");
{
  const f = fakePool();
  await runAsUnit(f.pool, SECRET, BEARER, async () => {
    await Promise.all([1, 2].map((i) => runAsPrincipal(f.pool, SECRET, BEARER, async (cc) => {
      await cc.query(`select ${i}`); await cc.query(`select ${i}${i}`);
      // A call from inside a call nests, and does not wait on itself.
      if (i === 1) await runAsPrincipal(f.pool, SECRET, BEARER, async (c3) => c3.query("select inner"));
    })));
    return { commit: true, value: null };
  });
  const sp = f.log.filter((l) => /SAVEPOINT|^select /.test(l));
  const first = sp.indexOf("RELEASE SAVEPOINT unit_call_1");
  const second = sp.indexOf("SAVEPOINT unit_call_3");
  ok("the second call's savepoint opens after the first is released", first >= 0 && second > first, sp.join(" | "));
  ok("the inner call nested inside the first", sp.indexOf("SAVEPOINT unit_call_2") < sp.indexOf("select inner")
     && sp.indexOf("select inner") < sp.indexOf("RELEASE SAVEPOINT unit_call_2") && sp.indexOf("RELEASE SAVEPOINT unit_call_2") < first);
}

group("afterCommit: at once outside a unit; at the COMMIT inside one; never on a rollback");
{
  /** @type {string[]} */
  const told = [];
  afterCommit(() => told.push("outside"));
  ok("outside a unit, at once", told.join() === "outside");
  const f = fakePool();
  await runAsUnit(f.pool, SECRET, BEARER, async () => {
    await runAsPrincipal(f.pool, SECRET, BEARER, async () => { afterCommit(() => told.push("committed")); });
    ok("inside, held until the COMMIT", !told.includes("committed"));
    return { commit: true, value: null };
  });
  ok("...and told once it has", told.includes("committed"));
  await runAsUnit(fakePool().pool, SECRET, BEARER, async () => {
    afterCommit(() => told.push("rolled back"));
    return { commit: false, value: null };
  });
  ok("a unit that rolls back tells nobody", !told.includes("rolled back"));
}

group("keyedWrite: claim, look, run, keep");
{
  const fp = fingerprint({ route: "POST /api/news", body: { t: 1 } });
  const answer = { status: 200, body: { id: "n1" } };

  const fresh = fakePool();
  let ran = 0;
  const r1 = await keyedWrite({ pool: fresh.pool, secret: SECRET, bearer: BEARER, key: "k", route: "POST /api/news", fp,
                                run: async () => { ran++; return answer; } });
  ok("a new key runs the handler once", ran === 1 && r1.kind === "ran");
  ok("the claim is taken before the receipt is looked for", idx(fresh.log, /pg_advisory_xact_lock/) >= 0
     && idx(fresh.log, /pg_advisory_xact_lock/) < idx(fresh.log, /from request_replay/));
  ok("the wait for it is bounded, then put back", idx(fresh.log, /set_config\('lock_timeout'/) < idx(fresh.log, /pg_advisory_xact_lock/)
     && count(fresh.log, /set_config\('lock_timeout'/) === 2);
  ok("the receipt carries the route and the fingerprint, and commits with the row", idx(fresh.log, /insert into request_replay/) < idx(fresh.log, /^COMMIT$/));

  const same = fakePool({ seen: { route: `POST /api/news sha256:${fp}`, status: 200, body: { id: "n1" } } });
  ran = 0;
  const r2 = await keyedWrite({ pool: same.pool, secret: SECRET, bearer: BEARER, key: "k", route: "POST /api/news", fp, run: async () => { ran++; return answer; } });
  ok("the same request replays, and nothing runs", r2.kind === "replayed" && ran === 0 && /** @type {any} */ (r2.answer.body).id === "n1");
  ok("...and nothing is committed", count(same.log, /^COMMIT$/) === 0 && count(same.log, /^ROLLBACK$/) === 1);

  const changed = fakePool({ seen: { route: `POST /api/news sha256:${"0".repeat(64)}`, status: 200, body: { id: "n1" } } });
  const r3 = await keyedWrite({ pool: changed.pool, secret: SECRET, bearer: BEARER, key: "k", route: "POST /api/news", fp, run: async () => { ran++; return answer; } });
  ok("a changed body under the key is refused 422", r3.kind === "refused" && r3.answer.status === 422
     && /** @type {any} */ (r3.answer.body).error === "idempotency_key_payload_mismatch" && ran === 0);

  const other = fakePool({ seen: { route: `POST /api/news/n1/withdraw n1 sha256:${fp}`, status: 200, body: {} } });
  const r4 = await keyedWrite({ pool: other.pool, secret: SECRET, bearer: BEARER, key: "k", route: "POST /api/news", fp, run: async () => { ran++; return answer; } });
  ok("another route under the key is refused 422 as before", r4.kind === "refused" && /** @type {any} */ (r4.answer.body).error === "idempotency_key_reused");

  const legacy = fakePool({ seen: { route: "POST /api/news", status: 200, body: { id: "n0" } } });
  const r5 = await keyedWrite({ pool: legacy.pool, secret: SECRET, bearer: BEARER, key: "k", route: "POST /api/news", fp, run: async () => { ran++; return answer; } });
  ok("a receipt from before fingerprints is compared on its route alone", r5.kind === "replayed");

  const broken = fakePool();
  const r6 = await keyedWrite({ pool: broken.pool, secret: SECRET, bearer: BEARER, key: "k", route: "POST /api/news", fp,
                                run: async () => ({ status: 500, body: { error: "boom" } }) });
  ok("a 5xx keeps nothing: no receipt, and the unit rolls back",
     r6.kind === "ran" && !r6.committed && count(broken.log, /insert into request_replay/) === 0 && count(broken.log, /^ROLLBACK$/) === 1);

  const busy = fakePool({ failOn: /pg_advisory_xact_lock/ });
  // The fake throws 42501; a lock wait that runs out is 55P03.
  busy.pool.connect = (orig => async () => { const c = await orig(); const q = c.query.bind(c);
    c.query = async (/** @type {string} */ t) => { try { return await q(t); } catch (/** @type {any} */ e) { e.code = "55P03"; throw e; } }; return c; })(busy.pool.connect);
  const r7 = await keyedWrite({ pool: busy.pool, secret: SECRET, bearer: BEARER, key: "k", route: "POST /api/news", fp, run: async () => { ran++; return answer; } });
  ok("a copy that waits past the bound is told the key is in flight (409)", r7.kind === "refused" && r7.answer.status === 409
     && /** @type {any} */ (r7.answer.body).error === "idempotency_key_in_flight");
}

console.log(`\nREPLAY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
