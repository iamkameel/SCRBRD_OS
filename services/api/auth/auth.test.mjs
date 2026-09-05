/**
 * Proves the auth core: token integrity, what a principal is allowed to
 * contain, and — most importantly — that DB context is transaction-local (no
 * bleed across pooled connections). Cannot exercise real Postgres; it verifies
 * the exact SQL and ordering the app will run, and simulates a shared
 * connection to prove the leak is impossible by construction.
 *
 * Several assertions here are NEGATIVE — they check that role, school, teams
 * and children are absent from the token and from the session config. That is
 * the point of ADR 0001: those are looked up by the database, and a session
 * that can state them is a session that can lie about them.
 */
import {
  signToken, verifyToken, principalFromClaims, sessionConfigStatements,
  withPrincipal, authMiddleware, ANON, AuthError, TOKEN, newMagicCode, magicHash,
} from "./auth.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = t => console.log("\n" + t);
const SECRET = "test-secret-do-not-use-in-prod";
const ID = { userId: "u1", deviceId: "dev-a" };

// ── Token integrity ──
group("Token integrity");
{
  const t = signToken(ID, SECRET);
  const claims = verifyToken(t, SECRET);
  ok("roundtrip preserves identity", claims.sub === "u1" && claims.did === "dev-a");
  ok("carries iss/aud/exp", claims.iss === TOKEN.iss && claims.aud === TOKEN.aud && typeof claims.exp === "number");

  // tamper: re-encode the payload with an added claim
  const [h, p, s] = t.split(".");
  const badP = Buffer.from(JSON.stringify({ ...claims, role: "superadmin" })).toString("base64url");
  let threw = false;
  try { verifyToken(`${h}.${badP}.${s}`, SECRET); } catch (e) { threw = e.code === "bad_signature"; }
  ok("privilege-escalation tamper rejected", threw);

  // wrong secret
  let threw2 = false;
  try { verifyToken(t, "other-secret"); } catch (e) { threw2 = e.code === "bad_signature"; }
  ok("wrong secret rejected", threw2);

  // expired
  const old = signToken(ID, SECRET, () => 0);
  let threw3 = false;
  try { verifyToken(old, SECRET, () => Date.now()); } catch (e) { threw3 = e.code === "token_expired"; }
  ok("expired token rejected", threw3);

  // malformed
  let threw4 = false;
  try { verifyToken("not.a.jwt.at.all", SECRET); } catch (e) { threw4 = e instanceof AuthError; }
  ok("malformed token rejected", threw4);

  ok("signToken demands a user", (() => { try { signToken({ deviceId: "d" }, SECRET); return false; } catch { return true; } })());
  // An unbound token is one that any device can score with — see auth.mjs (2).
  ok("signToken demands a device", (() => { try { signToken({ userId: "u1" }, SECRET); return false; } catch { return true; } })());
}

// ── Trust boundary ──
group("Trust boundary — the token says WHO, never WHAT");
{
  const t = signToken(ID, SECRET);
  const body = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8"));
  const keys = Object.keys(body).sort().join(",");
  ok("claims are identity only", keys === "aud,did,exp,iat,iss,sub");
  for (const banned of ["role", "school_id", "teams", "child_ids", "capabilities"])
    ok(`no ${banned} claim`, !(banned in body));

  // A token that somehow carried a role would still not be believed: nothing
  // downstream reads one.
  const forged = principalFromClaims({ sub: "u1", did: "dev-a", role: "superadmin", school_id: "X" });
  ok("a role in the claims is ignored", forged.role === undefined && forged.schoolId === undefined);
  ok("principal is exactly userId + deviceId",
     Object.keys(forged).sort().join(",") === "deviceId,userId");
}

// ── Session config = exactly what the database reads, transaction-LOCAL ──
group("Session config statements");
{
  const stmts = sessionConfigStatements({ userId: "u1", deviceId: "dev-a" });
  const vars = stmts.map(s => s.text.match(/'app\.\w+'/)[0]);
  ok("sets exactly two app.* vars", vars.length === 2);
  ok("sets app.user_id and app.device_id",
     vars.includes("'app.user_id'") && vars.includes("'app.device_id'"));
  // The variables the old model set. Each was a self-assertion; app_can() now
  // resolves all of them from role_assignment.
  for (const gone of ["'app.role'", "'app.school_id'", "'app.player_id'", "'app.child_ids'", "'app.teams'"])
    ok(`no longer sets ${gone}`, !vars.includes(gone));

  ok("EVERY statement is transaction-local (, true)", stmts.every(s => /, true\)$/.test(s.text)));
  ok("no statement uses session scope (, false)", stmts.every(s => !/, false\)/.test(s.text)));
  ok("identity is parameterised, never interpolated", stmts.every(s => /\$1/.test(s.text)));

  // Anonymous: empty string → app_user_id() is NULL → matches no assignment.
  const anon = sessionConfigStatements(null);
  ok("null principal → empty user id", anon.find(s => s.text.includes("app.user_id")).params[0] === "");
  ok("ANON carries no identity", ANON.userId === null && ANON.deviceId === null);
}

// ── The pooling-leak guard: prove context cannot bleed ──
group("No context bleed across a shared (pooled) connection");
{
  // Fake client recording every statement; simulates one physical connection
  // reused by two requests, as a pool would.
  const log = [];
  const client = { query: async (text, params) => { log.push({ text: text.trim(), params }); return { rows: [] }; } };

  const A = { userId: "uA", deviceId: "dev-a" };
  const B = { userId: "uB", deviceId: "dev-b" };

  await withPrincipal(client, A, async c => { await c.query("select * from player"); });
  await withPrincipal(client, B, async c => { await c.query("select * from player"); });

  const begins = log.filter(l => l.text === "BEGIN").length;
  const commits = log.filter(l => l.text === "COMMIT").length;
  ok("each request has its own transaction", begins === 2 && commits === 2);

  const aId = log.find(l => l.text.includes("app.user_id") && l.params[0] === "uA");
  const bId = log.find(l => l.text.includes("app.user_id") && l.params[0] === "uB");
  ok("A sets uA, B sets uB (context re-established per txn)", !!aId && !!bId);
  ok("all config is LOCAL so it dies at COMMIT (no leak)", log.filter(l => l.text.includes("set_config")).every(l => /, true\)/.test(l.text)));

  // ordering: BEGIN before any set_config before the query before COMMIT
  const idx = t => log.findIndex(l => l.text === t || l.text.includes(t));
  ok("ordering BEGIN → set_config → query → COMMIT",
     idx("BEGIN") < idx("set_config") && idx("set_config") < idx("select * from player") && idx("select * from player") < idx("COMMIT"));
}

// ── Rollback releases context even on error ──
group("Rollback on error");
{
  const log = [];
  const client = { query: async (t) => { log.push(t.trim()); if (t.includes("boom")) throw new Error("boom"); return { rows: [] }; } };
  let caught = false;
  try { await withPrincipal(client, { userId: "uA", deviceId: "dev-a" }, async c => c.query("boom")); }
  catch { caught = true; }
  ok("error propagates", caught);
  ok("ROLLBACK issued (context discarded)", log.includes("ROLLBACK"));
  ok("no COMMIT after failure", !log.includes("COMMIT"));
}

// ── Middleware ──
group("Auth middleware");
{
  const mw = authMiddleware({ secret: SECRET });
  const run = async (headers) => {
    const req = { headers }; let status = 200, body = null, nexted = false;
    const res = { status: c => (status = c, res), json: b => (body = b, res) };
    await mw(req, res, () => { nexted = true; });
    return { req, status, body, nexted };
  };
  const good = signToken({ userId: "uCoach", deviceId: "dev-a" }, SECRET);
  let r = await run({ authorization: `Bearer ${good}` });
  ok("valid token → principal attached + next()",
     r.nexted && r.req.principal.userId === "uCoach" && r.req.principal.deviceId === "dev-a");

  r = await run({});
  ok("missing token → 401 (requireAuth default)", r.status === 401 && r.body.error === "missing_token");

  r = await run({ authorization: "Bearer garbage.token.here" });
  ok("bad token → 401 with code", r.status === 401 && typeof r.body.error === "string");

  // A device named in a header is NOT identity — only the signed one counts.
  r = await run({ authorization: `Bearer ${good}`, "x-device-id": "dev-stolen" });
  ok("a header cannot restate the device", r.req.principal.deviceId === "dev-a");

  const mwOpen = authMiddleware({ secret: SECRET, requireAuth: false });
  let req2 = { headers: {} }, ok2 = false;
  await mwOpen(req2, { status: () => ({ json: () => {} }) }, () => { ok2 = req2.principal === ANON; });
  ok("optional-auth route → ANON principal", ok2);
}

// ── Magic link ──
group("Magic-link login");
{
  const SECRET = "a-server-secret";
  const { raw, hash, expiresInSec } = newMagicCode(SECRET);
  ok("raw code is opaque + long", typeof raw === "string" && raw.length >= 24);
  ok("stored hash ≠ raw code", hash !== raw);
  ok("hash verifies the raw code", magicHash(raw, SECRET) === hash);
  ok("wrong code fails", magicHash("wrong", SECRET) !== hash);

  // KEYED WITH THE SERVER SECRET, not a constant in the source. It used to be
  // HMAC'd with the literal "scrbrd-magic-link" — a public value in a public
  // function, so the "hash" was a pure function anybody could compute. With
  // 192-bit codes that was not exploitable and it was still the wrong shape.
  ok("a different server produces a different hash for the same code",
     magicHash(raw, "another-server-secret") !== hash);
  ok("hashing without a secret is refused, not silently unkeyed", (() => {
    try { magicHash(raw, ""); return false; } catch { return true; }
  })());

  // An office-issued code outlives an emailed one on purpose: it is written on
  // an enrolment letter and set up that evening, not clicked within a minute.
  ok("an office code lasts days, not minutes", expiresInSec >= 24 * 60 * 60);
  ok("...and the caller can still ask for a short one",
     newMagicCode(SECRET, 900).expiresInSec === 900);

  // Two codes are never the same code.
  ok("codes do not repeat",
     new Set(Array.from({ length: 50 }, () => newMagicCode(SECRET).raw)).size === 50);
}

console.log(`\n${"─".repeat(52)}\nAUTH SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
