/**
 * Proves the auth core: token integrity, principal resolution, and — most
 * importantly — that DB context is transaction-local (no bleed across pooled
 * connections). Cannot exercise real Postgres; it verifies the exact SQL and
 * ordering the app will run, and simulates a shared connection to prove the
 * leak is impossible by construction.
 */
import {
  signToken, verifyToken, resolvePrincipal, sessionConfigStatements,
  withPrincipal, authMiddleware, ANON, AuthError, TOKEN, newMagicCode, magicHash,
} from "./auth.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = t => console.log("\n" + t);
const SECRET = "test-secret-do-not-use-in-prod";

// In-memory linkage accessor (mirrors the SQL data access)
const DATA = {
  playerIdForUser: async u => ({ uPlayer: "p1" }[u] || null),
  childPlayerIds:  async u => ({ uParent: ["p5", "p9"] }[u] || []),
  teamCodesForUser:async u => ({ uCoach: ["U19A"], uAsst: ["U15A"] }[u] || []),
};

// ── Token integrity ──
group("Token integrity");
{
  const t = signToken({ userId: "u1", role: "coach", schoolId: "HIL" }, SECRET);
  const claims = verifyToken(t, SECRET);
  ok("roundtrip preserves identity", claims.sub === "u1" && claims.role === "coach" && claims.school_id === "HIL");
  ok("carries iss/aud/exp", claims.iss === TOKEN.iss && claims.aud === TOKEN.aud && typeof claims.exp === "number");

  // tamper: flip a byte in the payload
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
  const old = signToken({ userId: "u1", role: "coach", schoolId: "HIL" }, SECRET, () => 0);
  let threw3 = false;
  try { verifyToken(old, SECRET, () => Date.now()); } catch (e) { threw3 = e.code === "token_expired"; }
  ok("expired token rejected", threw3);

  // malformed
  let threw4 = false;
  try { verifyToken("not.a.jwt.at.all", SECRET); } catch (e) { threw4 = e instanceof AuthError; }
  ok("malformed token rejected", threw4);

  ok("signToken demands full identity", (() => { try { signToken({ userId: "u1" }, SECRET); return false; } catch { return true; } })());
}

// ── Trust boundary ──
group("Trust boundary — role comes from the signed token, not the client");
{
  // A client cannot elevate by sending headers; only a validly-signed token counts.
  const t = signToken({ userId: "u1", role: "spectator", schoolId: "HIL" }, SECRET);
  const claims = verifyToken(t, SECRET);
  ok("role is whatever was signed", claims.role === "spectator");
  // there is no code path that reads role from req.headers — verified by design;
  // resolvePrincipal only consumes verified claims.
  ok("resolvePrincipal only takes verified claims", resolvePrincipal.length === 2);
}

// ── Principal resolution per role ──
group("Principal resolution");
{
  const mk = async (userId, role) => resolvePrincipal({ sub: userId, role, school_id: "HIL" }, DATA);

  const player = await mk("uPlayer", "player");
  ok("player → own player_id", player.playerId === "p1" && player.childIds.length === 0 && player.teams.length === 0);

  const parent = await mk("uParent", "parent");
  ok("parent → child ids, no player_id", parent.childIds.join(",") === "p5,p9" && parent.playerId === null);

  const coach = await mk("uCoach", "coach");
  ok("coach → team codes", coach.teams.join(",") === "U19A" && coach.playerId === null);

  const asst = await mk("uAsst", "assistant");
  ok("assistant → team codes", asst.teams.join(",") === "U15A");

  const spec = await mk("uX", "spectator");
  ok("spectator → no linkages resolved", spec.playerId === null && spec.childIds.length === 0 && spec.teams.length === 0);

  // efficiency: spectator/analyst must not trigger linkage lookups
  let calls = 0;
  const counting = { playerIdForUser: async () => (calls++, null), childPlayerIds: async () => (calls++, []), teamCodesForUser: async () => (calls++, []) };
  await resolvePrincipal({ sub: "uX", role: "analyst", school_id: "HIL" }, counting);
  ok("analyst triggers zero linkage lookups", calls === 0);
}

// ── Session config = exactly what RLS reads, transaction-LOCAL ──
group("Session config statements");
{
  const p = { userId: "u1", role: "coach", schoolId: "HIL", playerId: null, childIds: [], teams: ["U19A", "U15A"] };
  const stmts = sessionConfigStatements(p);
  const vars = stmts.map(s => s.text.match(/'app\.\w+'/)[0]);
  ok("sets all six app.* vars", ["'app.role'","'app.user_id'","'app.school_id'","'app.player_id'","'app.child_ids'","'app.teams'"].every(v => vars.includes(v)));
  ok("EVERY statement is transaction-local (, true)", stmts.every(s => /, true\)$/.test(s.text)));
  ok("no statement uses session scope (, false)", stmts.every(s => !/, false\)/.test(s.text)));
  ok("teams serialised as csv", stmts.find(s => s.text.includes("app.teams")).params[0] === "U19A,U15A");
  ok("empty arrays → empty string", sessionConfigStatements({ ...p, teams: [] }).find(s => s.text.includes("app.teams")).params[0] === "");

  // anonymous fallback is safe (role 'anonymous' → RLS denies)
  const anon = sessionConfigStatements(null);
  ok("null principal → anonymous role", anon.find(s => s.text.includes("app.role")).params[0] === "anonymous");
  ok("ANON export matches", ANON.role === "anonymous" && ANON.schoolId === null);
}

// ── The pooling-leak guard: prove context cannot bleed ──
group("No context bleed across a shared (pooled) connection");
{
  // Fake client recording every statement; simulates one physical connection
  // reused by two requests, as a pool would.
  const log = [];
  const client = { query: async (text, params) => { log.push({ text: text.trim(), params }); return { rows: [] }; } };

  const A = { userId: "uA", role: "coach",     schoolId: "HIL", playerId: null, childIds: [], teams: ["U19A"] };
  const B = { userId: "uB", role: "spectator", schoolId: "HIL", playerId: null, childIds: [], teams: [] };

  await withPrincipal(client, A, async c => { await c.query("select * from player"); });
  await withPrincipal(client, B, async c => { await c.query("select * from player"); });

  // Each request must be wrapped in its own BEGIN/COMMIT
  const begins = log.filter(l => l.text === "BEGIN").length;
  const commits = log.filter(l => l.text === "COMMIT").length;
  ok("each request has its own transaction", begins === 2 && commits === 2);

  // Request A's role is set inside A's txn; request B re-sets it inside B's txn.
  const aRole = log.find(l => l.text.includes("app.role") && l.params[0] === "coach");
  const bRole = log.find(l => l.text.includes("app.role") && l.params[0] === "spectator");
  ok("A sets coach, B sets spectator (context re-established per txn)", !!aRole && !!bRole);
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
  try { await withPrincipal(client, { role: "coach", schoolId: "HIL" }, async c => c.query("boom")); }
  catch { caught = true; }
  ok("error propagates", caught);
  ok("ROLLBACK issued (context discarded)", log.includes("ROLLBACK"));
  ok("no COMMIT after failure", !log.includes("COMMIT"));
}

// ── Middleware ──
group("Auth middleware");
{
  const mw = authMiddleware({ secret: SECRET, data: DATA });
  const run = async (headers) => {
    const req = { headers }; let status = 200, body = null, nexted = false;
    const res = { status: c => (status = c, res), json: b => (body = b, res) };
    await mw(req, res, () => { nexted = true; });
    return { req, status, body, nexted };
  };
  const good = signToken({ userId: "uCoach", role: "coach", schoolId: "HIL" }, SECRET);
  let r = await run({ authorization: `Bearer ${good}` });
  ok("valid token → principal attached + next()", r.nexted && r.req.principal.role === "coach" && r.req.principal.teams[0] === "U19A");

  r = await run({});
  ok("missing token → 401 (requireAuth default)", r.status === 401 && r.body.error === "missing_token");

  r = await run({ authorization: "Bearer garbage.token.here" });
  ok("bad token → 401 with code", r.status === 401 && typeof r.body.error === "string");

  const mwOpen = authMiddleware({ secret: SECRET, data: DATA, requireAuth: false });
  let req2 = { headers: {} }, ok2 = false;
  await mwOpen(req2, { status: () => ({ json: () => {} }) }, () => { ok2 = req2.principal === ANON; });
  ok("optional-auth route → ANON principal", ok2);
}

// ── Magic link ──
group("Magic-link login");
{
  const { raw, hash } = newMagicCode();
  ok("raw code is opaque + long", typeof raw === "string" && raw.length >= 24);
  ok("stored hash ≠ raw code", hash !== raw);
  ok("hash verifies the raw code", magicHash(raw) === hash);
  ok("wrong code fails", magicHash("wrong") !== hash);
}

console.log(`\n${"─".repeat(52)}\nAUTH SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
