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
/** @param {string} n @param {unknown} c */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
const SECRET = "test-secret-do-not-use-in-prod";
const SID = "5e551011-0000-4000-8000-000000000001";
const ID = { userId: "u1", deviceId: "dev-a", sessionId: SID, epoch: 3 };

// ── Token integrity ──
group("Token integrity");
{
  const t = signToken(ID, SECRET);
  const claims = verifyToken(t, SECRET);
  ok("roundtrip preserves identity", claims.sub === "u1" && claims.did === "dev-a");
  ok("...and the session it was minted in, under its epoch (db/85)", claims.sid === SID && claims.sep === 3);
  ok("carries iss/aud/exp", claims.iss === TOKEN.iss && claims.aud === TOKEN.aud && typeof claims.exp === "number");

  // tamper: re-encode the payload with an added claim
  const [h, _p, s] = t.split(".");
  const badP = Buffer.from(JSON.stringify({ ...claims, role: "superadmin" })).toString("base64url");
  let threw = false;
  try { verifyToken(`${h}.${badP}.${s}`, SECRET); } catch (/** @type {any} */ e) { threw = e.code === "bad_signature"; }
  ok("privilege-escalation tamper rejected", threw);

  // wrong secret
  let threw2 = false;
  try { verifyToken(t, "other-secret"); } catch (/** @type {any} */ e) { threw2 = e.code === "bad_signature"; }
  ok("wrong secret rejected", threw2);

  // expired
  const old = signToken(ID, SECRET, () => 0);
  let threw3 = false;
  try { verifyToken(old, SECRET, () => Date.now()); } catch (/** @type {any} */ e) { threw3 = e.code === "token_expired"; }
  ok("expired token rejected", threw3);

  // malformed
  let threw4 = false;
  try { verifyToken("not.a.jwt.at.all", SECRET); } catch (e) { threw4 = e instanceof AuthError; }
  ok("malformed token rejected", threw4);

  // @ts-expect-error — the point of the test: a call with no userId.
  ok("signToken demands a user", (() => { try { signToken({ deviceId: "d" }, SECRET); return false; } catch { return true; } })());
  // An unbound token is one that any device can score with — see auth.mjs (2).
  // @ts-expect-error — the point of the test: a call with no deviceId.
  ok("signToken demands a device", (() => { try { signToken({ userId: "u1" }, SECRET); return false; } catch { return true; } })());
  // A token the server cannot end is the defect db/85 closed (GA-I03).
  // @ts-expect-error — the point of the test: a call with no session.
  ok("signToken demands a session", (() => { try { signToken({ userId: "u1", deviceId: "d" }, SECRET); return false; } catch { return true; } })());
  ok("...and an epoch", (() => { try { signToken({ userId: "u1", deviceId: "d", sessionId: SID, epoch: /** @type {any} */ ("1") }, SECRET); return false; } catch { return true; } })());

  // A correctly signed token with no session — every token minted before
  // db/85 — is refused, and so is one whose sid is not a session id.
  const { createHmac } = await import("node:crypto");
  const forge = (/** @type {Record<string, unknown>} */ extra) => {
    const [h2, p2] = t.split(".");
    const body = { ...JSON.parse(Buffer.from(p2, "base64url").toString()), ...extra };
    const pp = Buffer.from(JSON.stringify(body)).toString("base64url");
    return `${h2}.${pp}.${createHmac("sha256", SECRET).update(`${h2}.${pp}`).digest("base64url")}`;
  };
  const code = (/** @type {string} */ tok) => { try { verifyToken(tok, SECRET); return "accepted"; } catch (/** @type {any} */ e) { return e.code; } };
  ok("a signed token with no session is incomplete_claims", code(forge({ sid: undefined, sep: undefined })) === "incomplete_claims");
  ok("...nor with a sid that is not a session id", code(forge({ sid: "x' or 1=1" })) === "incomplete_claims");
  ok("...nor with an epoch that is not a whole number", code(forge({ sep: 1.5 })) === "incomplete_claims" && code(forge({ sep: -1 })) === "incomplete_claims");
}

// ── Trust boundary ──
group("Trust boundary — the token says WHO, never WHAT");
{
  const t = signToken(ID, SECRET);
  const body = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8"));
  const keys = Object.keys(body).sort().join(",");
  ok("claims are identity only (who, which device, which session)", keys === "aud,did,exp,iat,iss,sep,sid,sub");
  for (const banned of ["role", "school_id", "teams", "child_ids", "capabilities"])
    ok(`no ${banned} claim`, !(banned in body));

  // A token that somehow carried a role would still not be believed: nothing
  // downstream reads one.
  // A cast, not a claims object: the test hands over what a forged token would.
  const forged = /** @type {Record<string, unknown>} */ (principalFromClaims(/** @type {any} */ ({ sub: "u1", did: "dev-a", role: "superadmin", school_id: "X" })));
  ok("a role in the claims is ignored", forged.role === undefined && forged.schoolId === undefined);
  ok("principal is exactly userId + deviceId + its session",
     Object.keys(forged).sort().join(",") === "deviceId,epoch,sessionId,userId");
  const fromToken = principalFromClaims(verifyToken(signToken(ID, SECRET), SECRET));
  ok("a token's principal carries its session and epoch", fromToken.sessionId === SID && fromToken.epoch === 3);
}

// ── Session config = exactly what the database reads, transaction-LOCAL ──
group("Session config statements");
{
  // Somebody: ONE statement, app_session_begin() (db/85), which checks the
  // session and then sets app.user_id and app.device_id transaction-locally
  // (db/85's own check and db/99 §64 prove the database half).
  const stmts = sessionConfigStatements({ userId: "u1", deviceId: "dev-a", sessionId: SID, epoch: 3 });
  ok("a signed-in principal is one statement: app_session_begin()", stmts.length === 1 && /^select app_session_begin\(\$1, \$2, \$3, \$4, \$5\)$/.test(stmts[0].text));
  ok("...with who, which device, which session, its epoch and no credential",
     JSON.stringify(stmts[0].params) === JSON.stringify(["u1", "dev-a", SID, 3, null]));
  // The variables the old model set. Each was a self-assertion; app_can() now
  // resolves all of them from role_assignment.
  const all = JSON.stringify(stmts);
  for (const gone of ["app.role", "app.school_id", "app.player_id", "app.child_ids", "app.teams"])
    ok(`no longer sets '${gone}'`, !all.includes(gone));
  ok("no statement uses session scope (, false)", stmts.every(s => !/, false\)/.test(s.text)));
  ok("identity is parameterised, never interpolated", stmts.every(s => /\$1/.test(s.text)) && !all.includes("'u1'"));

  // Anonymous: empty string → app_user_id() is NULL → matches no assignment.
  const anon = sessionConfigStatements(null);
  ok("null principal → empty user id", anon.find(s => s.text.includes("app.user_id"))?.params[0] === "");
  ok("...set transaction-local (, true), both", anon.length === 2 && anon.every(s => /, true\)$/.test(s.text)));
  ok("ANON carries no identity", ANON.userId === null && ANON.deviceId === null);

  // The pad: the credential, then its narrowing — all transaction-local.
  const pad = sessionConfigStatements({ userId: "u1", deviceId: "dev-a", scope: "pad", matchId: "m1", credentialId: "c1" });
  ok("a pad principal names its credential to app_session_begin()", pad[0].params[2] === null && pad[0].params[4] === "c1");
  ok("...then sets app.scope and app.match_id, transaction-local",
     pad.length === 3 && pad.slice(1).every(s => /, true\)$/.test(s.text)) && pad[1].params[0] === "pad" && pad[2].params[0] === "m1");
  ok("a pad principal with no credential is refused here", (() => { try { sessionConfigStatements({ userId: "u1", deviceId: "d", scope: "pad", matchId: "m1" }); return false; } catch (/** @type {any} */ e) { return e.code === "pad_scope_without_credential"; } })());
}

// ── The pooling-leak guard: prove context cannot bleed ──
group("No context bleed across a shared (pooled) connection");
{
  // Fake client recording every statement; simulates one physical connection
  // reused by two requests, as a pool would.
  /** @type {{ text: string, params: any[] | undefined }[]} */
  const log = [];
  /** @type {import("../api-types.mjs").Db} */
  const client = { query: async (text, params) => { log.push({ text: text.trim(), params }); return { rows: [] }; } };

  const A = { userId: "uA", deviceId: "dev-a", sessionId: SID, epoch: 0 };
  const B = { userId: "uB", deviceId: "dev-b", sessionId: SID, epoch: 0 };

  await withPrincipal(client, A, async c => { await c.query("select * from player"); });
  await withPrincipal(client, B, async c => { await c.query("select * from player"); });

  const begins = log.filter(l => l.text === "BEGIN").length;
  const commits = log.filter(l => l.text === "COMMIT").length;
  ok("each request has its own transaction", begins === 2 && commits === 2);

  const aId = log.find(l => l.text.includes("app_session_begin") && l.params?.[0] === "uA");
  const bId = log.find(l => l.text.includes("app_session_begin") && l.params?.[0] === "uB");
  ok("A sets uA, B sets uB (context re-established per txn)", !!aId && !!bId);
  ok("all config is LOCAL so it dies at COMMIT (no leak)", log.filter(l => l.text.includes("set_config")).every(l => /, true\)/.test(l.text)));

  // ordering: BEGIN before the identity before the query before COMMIT
  const idx = (/** @type {string} */ t) => log.findIndex(l => l.text === t || l.text.includes(t));
  ok("ordering BEGIN → app_session_begin → query → COMMIT",
     idx("BEGIN") < idx("app_session_begin") && idx("app_session_begin") < idx("select * from player") && idx("select * from player") < idx("COMMIT"));
}

// ── A refused session is a 401, and nothing runs ──
group("A session the database refuses (db/85)");
{
  /** @type {string[]} */
  const log = [];
  const client = { query: async (/** @type {string} */ t) => {
    log.push(t.trim());
    if (t.includes("app_session_begin")) throw Object.assign(new Error("session_revoked"), { code: "28000" });
    return { rows: [] };
  } };
  let caught = null, ran = false;
  try { await withPrincipal(client, { userId: "uA", deviceId: "dev-a", sessionId: SID, epoch: 0 }, async () => { ran = true; }); }
  catch (/** @type {any} */ e) { caught = e; }
  ok("it is an AuthError, 401 session_revoked", caught instanceof AuthError && caught.code === "session_revoked" && caught.status === 401);
  ok("...the handler never ran", !ran);
  ok("...and the transaction is rolled back", log.includes("ROLLBACK") && !log.includes("COMMIT"));
  // Any other failure there is not dressed up as a sign-out.
  const other = { query: async (/** @type {string} */ t) => { if (t.includes("app_session_begin")) throw Object.assign(new Error("x"), { code: "42883" }); return { rows: [] }; } };
  let e2 = null;
  try { await withPrincipal(other, { userId: "uA", deviceId: "dev-a", sessionId: SID, epoch: 0 }, async () => {}); } catch (/** @type {any} */ e) { e2 = e; }
  ok("another database error stays itself", e2 && !(e2 instanceof AuthError) && /** @type {any} */ (e2).code === "42883");
}

// ── Rollback releases context even on error ──
group("Rollback on error");
{
  /** @type {string[]} */
  const log = [];
  const client = { query: async (/** @type {string} */ t) => { log.push(t.trim()); if (t.includes("boom")) throw new Error("boom"); return { rows: [] }; } };
  let caught = false;
  try { await withPrincipal(client, { userId: "uA", deviceId: "dev-a", sessionId: SID, epoch: 0 }, async c => c.query("boom")); }
  catch { caught = true; }
  ok("error propagates", caught);
  ok("ROLLBACK issued (context discarded)", log.includes("ROLLBACK"));
  ok("no COMMIT after failure", !log.includes("COMMIT"));
}

// ── Middleware ──
group("Auth middleware");
{
  const mw = authMiddleware({ secret: SECRET });
  /** @param {Record<string, string>} headers */
  const run = async (headers) => {
    /** @type {{ headers: Record<string, string>, principal?: any }} */
    const req = { headers }; let status = 200, nexted = false;
    /** @type {any} */
    let body = null;
    /** @type {import("../api-types.mjs").ApiResponse} */
    const res = { status: c => (status = c, res), json: b => (body = b, res) };
    await mw(req, res, () => { nexted = true; });
    return { req, status, body, nexted };
  };
  const good = signToken({ userId: "uCoach", deviceId: "dev-a", sessionId: SID, epoch: 0 }, SECRET);
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
  /** @type {{ headers: {}, principal?: import("./auth.mjs").Principal }} */
  let req2 = { headers: {} }, ok2 = false;
  // A response that must never be used: optional auth never answers.
  await mwOpen(req2, /** @type {any} */ ({ status: () => ({ json: () => {} }) }), () => { ok2 = req2.principal === ANON; });
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
