#!/usr/bin/env node
/**
 * The rewards algorithm's coefficients, and the fact that nobody can read them.
 *
 * The figure this algorithm produces will be argued about — by a boy who got
 * less than his friend, by a parent, eventually by a rival school. What must
 * not happen is that it can be reverse-engineered, gamed, or quietly set by
 * somebody with an interest in the answer.
 *
 *   1. READ IS AS NARROW AS WRITE, which is the opposite of everywhere else in
 *      this schema. Here the value IS the secret, so reading it is the
 *      sensitive act and no role at a school holds it.
 *   2. THERE IS NO READ ROUTE AND NO READ RESOURCE. The write confirms the key
 *      and the date and never echoes the value.
 *   3. A COEFFICIENT IN FORCE CANNOT MOVE. An award is derived and never
 *      stored, so a past term stays re-derivable only while its inputs do.
 *   4. A PARTIAL ANSWER IS REFUSED. An award computed with a term missing is
 *      not a smaller award, it is a different algorithm.
 *   5. THE PLATFORM'S CAPABILITY IS NOT REACHABLE THROUGH A SCHOOL.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-rewards.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { WEIGHT_KEYS, weightAt, weightsFor } from "../services/api/rewards/weights.mjs";

const PORT = 8849;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-rewards-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: "device-rewards" } })).body?.token;
const setWeight = (key, token, body) =>
  api(`/api/admin/reward-weights/${encodeURIComponent(key)}`, { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

/** One statement under a person's own policies, rolled back. SET LOCAL ROLE is
 *  load-bearing: the migration role owns these tables and RLS does not apply
 *  to an owner, so without it the assertion proves nothing. */
async function asPerson(personId, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE scrbrd_app");
    await c.query("SELECT set_config('app.user_id', $1, true)", [personId]);
    const r = await c.query(sql, params);
    await c.query("ROLLBACK");
    return { ok: true, rows: r.rows, count: r.rowCount };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    return { ok: false, code: e.code, message: e.message };
  } finally { c.release(); }
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const platform  = await login("platform@example.invalid");
  const registrar = await login("registrar@example.invalid");  // schooladmin at Hilton
  const principal = await login("principal@example.invalid");
  const head      = await login("sarah@example.invalid");      // director of sport
  const coach     = await login("coach@example.invalid");
  const idOf = async (email) => (await q(`select id from app_user where email = $1`, [email]))[0].id;

  group("Only the platform sets the algorithm");
  {
    // Dated rather than defaulted, because the versioning assertions below
    // need a past to re-derive. A first draft left it at today and then
    // claimed a June date returned the January value, which it could not.
    const r = await setWeight(WEIGHT_KEYS.growth, platform,
      { value: 0.45, effectiveFrom: "2026-01-01", note: "Initial" });
    ok("a platform administrator can set a coefficient", r.status === 200);
    ok("...the confirmation names the key", r.body?.key === WEIGHT_KEYS.growth);
    ok("...and the date it takes effect from", !!r.body?.effectiveFrom);
    // A round trip that hands back what you sent is a read endpoint with extra
    // steps, and it would work for somebody guessing values one at a time.
    ok("...and never echoes the value",
       !JSON.stringify(r.body).includes("0.45") && r.body?.value === undefined);
    ok("...with the setter taken from the session, not the body",
       (await q(`select set_by from reward_weight where key = $1`, [WEIGHT_KEYS.growth]))[0]
         .set_by === await idOf("platform@example.invalid"));

    const spoofed = await setWeight(WEIGHT_KEYS.rating, platform,
      { value: 0.2, setBy: await idOf("coach@example.invalid") });
    ok("set_by cannot be spoofed from the request", spoofed.status === 200
       && (await q(`select set_by from reward_weight where key = $1`, [WEIGHT_KEYS.rating]))[0]
            .set_by === await idOf("platform@example.invalid"));

    // Nobody at a school, however senior. A school that could set its own
    // coefficients could inflate its own boys in a comparison spanning
    // schools, which is the one thing the figure is for.
    for (const [who, tok] of [["a school administrator", registrar], ["a principal", principal],
                              ["a director of sport", head], ["a coach", coach]]) {
      ok(`${who} cannot`, [403, 401].includes(
        (await setWeight(WEIGHT_KEYS.performance, tok, { value: 9.9 })).status));
    }
    ok("...and nothing of theirs was written",
       (await q(`select count(*)::int c from reward_weight where key = $1`,
                [WEIGHT_KEYS.performance]))[0].c === 0);
  }

  group("Reading is as narrow as writing, which is the point");
  {
    // Everywhere else in this schema a capability to read is wider than one to
    // write. Here the value is the secret, so it is not.
    for (const [who, email] of [["a coach", "coach@example.invalid"],
                                ["a principal", "principal@example.invalid"],
                                ["a school administrator", "registrar@example.invalid"],
                                ["a director of sport", "sarah@example.invalid"]]) {
      const r = await asPerson(await idOf(email), `select count(*)::int c from reward_weight`);
      ok(`${who} reads no coefficients`, r.ok && r.rows[0].c === 0);
    }
    const asPlatform = await asPerson(await idOf("platform@example.invalid"),
      `select count(*)::int c from reward_weight`);
    ok("the platform reads its own", asPlatform.ok && asPlatform.rows[0].c > 0);

    // THE AMPLIFIER THIS CLASS OF CAPABILITY EXISTS TO CLOSE. A platform
    // capability held through a school-scoped assignment is a contradiction —
    // the assignment says "at this school" and the capability says "there is
    // no school" — and app_holds() refuses the combination.
    const sneak = await q(
      `insert into role_assignment (person_id, role, school_id, active)
       values ($1, 'platformadmin', $2, true) returning id`,
      [await idOf("coach@example.invalid"), HIL]);
    const stillNo = await asPerson(await idOf("coach@example.invalid"),
      `select count(*)::int c from reward_weight`);
    ok("a platform role granted AT A SCHOOL does not reach it",
       stillNo.ok && stillNo.rows[0].c === 0);
    await q(`update role_assignment set active = false where id = $1`, [sneak[0].id]);
  }

  group("There is no way to ask the API for a coefficient");
  {
    const health = (await api("/api/health")).body;
    const resources = health?.read ?? [];
    ok("the read path advertises resources", resources.length > 0);
    // Not "no resource called reward_weights" — no resource whose NAME even
    // suggests it, so a future one cannot slip in under a different spelling
    // without this failing.
    ok("...and none of them is about rewards or weights",
       !resources.some((r) => /reward|weight|coefficient/i.test(r)));
    ok("asking for one by name is an unknown resource",
       (await api("/api/read/reward_weights", { token: platform })).status === 404);
    ok("...and so is the singular", (await api("/api/read/reward_weight", { token: platform })).status === 404);
    // A GET on the write route is not a read route either.
    ok("the write route does not answer a GET",
       [404, 405].includes((await api(`/api/admin/reward-weights/${WEIGHT_KEYS.growth}`,
                                      { token: platform })).status));
  }

  group("A coefficient in force cannot move");
  {
    const row = (await q(`select id, value from reward_weight where key = $1`, [WEIGHT_KEYS.growth]))[0];
    // An award is derived and never stored. Editing an input that a past term
    // was awarded on would silently re-write the past.
    const edit = await asPerson(await idOf("platform@example.invalid"),
      `update reward_weight set value = 0.9 where id = $1`, [row.id]);
    ok("even the platform cannot edit a value", !edit.ok && edit.code === "23514");
    ok("...nor the date it took effect from",
       !(await asPerson(await idOf("platform@example.invalid"),
          `update reward_weight set effective_from = current_date + 30 where id = $1`,
          [row.id])).ok);
    // A note is not an input to anything, so correcting one is allowed.
    const note = await asPerson(await idOf("platform@example.invalid"),
      `update reward_weight set note = 'Corrected rationale' where id = $1`, [row.id]);
    ok("a note can be corrected", note.ok && note.count === 1);
    ok("the same key on the same day is a conflict, not an overwrite",
       (await setWeight(WEIGHT_KEYS.growth, platform,
          { value: 0.5, effectiveFrom: "2026-01-01" })).status === 409);
    ok("...and the standing value is untouched",
       Number((await q(`select value from reward_weight where key = $1`,
                       [WEIGHT_KEYS.growth]))[0].value) === 0.45);
  }

  group("A change is a new row with a later date, and the past still derives");
  {
    ok("a later coefficient can be set",
       (await setWeight(WEIGHT_KEYS.growth, platform,
          { value: 0.7, effectiveFrom: "2027-01-01",
            note: "Growth weighted higher for age-group cricket" })).status === 200);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE scrbrd_app");
      // The accessor is SECURITY DEFINER because the computation runs as
      // whoever asked for a boy's figure, and that person may not read the
      // table. Granted to the application role only.
      ok("the accessor gives the value in force today",
         (await weightAt(c, WEIGHT_KEYS.growth)) === 0.45);
      ok("...the later one once it has taken effect",
         (await weightAt(c, WEIGHT_KEYS.growth, "2027-06-01")) === 0.7);
      // THE PROPERTY VERSIONING EXISTS FOR: last term re-derives to the same
      // figure it was awarded on.
      ok("...and the earlier one for a date before the change",
         (await weightAt(c, WEIGHT_KEYS.growth, "2026-06-01")) === 0.45);
      ok("...and nothing at all before any of them were set",
         (await weightAt(c, WEIGHT_KEYS.growth, "2020-01-01")) === null);
      await c.query("ROLLBACK");
    } finally { c.release(); }
  }

  group("A partial algorithm is refused, not quietly run with a term missing");
  {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE scrbrd_app");
      const partial = await weightsFor(c);
      // growth and rating are set; the other four are not.
      ok("an incomplete set does not compute", partial.ok === false);
      ok("...and says exactly which terms are missing",
         Array.isArray(partial.missing) && partial.missing.length === 4);
      // Null must never be read as zero: a missing growth weight silently
      // turning the growth term off produces a plausible figure built on the
      // wrong algorithm, and nothing on screen would say so.
      ok("...naming them, so an operator can set them",
         partial.missing.includes(WEIGHT_KEYS.growth) === false
         && partial.missing.includes(WEIGHT_KEYS.performance));
      await c.query("ROLLBACK");
    } finally { c.release(); }

    for (const key of [WEIGHT_KEYS.performance, WEIGHT_KEYS.evidence,
                       WEIGHT_KEYS.windowCap, WEIGHT_KEYS.teamGate]) {
      await setWeight(key, platform, { value: 0.25 });
    }
    const c2 = await pool.connect();
    try {
      await c2.query("BEGIN");
      await c2.query("SET LOCAL ROLE scrbrd_app");
      const full = await weightsFor(c2);
      ok("a complete set computes", full.ok === true);
      ok("...with every term of the algorithm present",
         Object.keys(full.weights).length === Object.keys(WEIGHT_KEYS).length);
      await c2.query("ROLLBACK");
    } finally { c2.release(); }
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`REWARDS SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
