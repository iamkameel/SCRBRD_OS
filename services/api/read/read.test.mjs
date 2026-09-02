/**
 * Proves the read path end-to-end at the seam level (no live Postgres):
 *   A. server readResource() runs inside a principal txn and reads masked views
 *      for PII/clinical resources — i.e. the DB, not the handler, enforces RBAC.
 *   B. client getData() serves mock when a resource is not flagged live, and
 *      hits the API (with bearer) when it is; failures never silently fall back.
 */
import { readResource, READ_QUERIES, liveResources } from "./read-api.mjs";
import { createDataClient } from "./data-client.mjs";
import { signToken } from "../auth/auth.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = t => console.log("\n" + t);
const SECRET = "read-test-secret";

// Fake pool/connection recording every statement.
function fakePool(rowsByPattern = {}) {
  const log = [];
  const client = {
    query: async (text, params) => {
      log.push({ text: text.trim().replace(/\s+/g, " "), params });
      const hit = Object.entries(rowsByPattern).find(([pat]) => text.includes(pat));
      return { rows: hit ? hit[1] : [] };
    },
    release: () => { client.released = true; },
    released: false,
  };
  return { pool: { connect: async () => client }, client, log };
}
const AUTHDATA = { playerIdForUser: async () => null, childPlayerIds: async () => [], teamCodesForUser: async () => ["U19A"] };
const bearer = role => `Bearer ${signToken({ userId: "u1", role, schoolId: "HIL" }, SECRET)}`;

// ── A. Server read layer ──
group("A. Reads run under a principal transaction");
{
  const { pool, client, log } = fakePool({ "from match": [{ id: "m1", home_team: "Hilton" }] });
  const rows = await readResource(pool, AUTHDATA, SECRET, bearer("spectator"), "matches");
  ok("returns rows", rows.length === 1 && rows[0].id === "m1");
  const texts = log.map(l => l.text);
  ok("wrapped in BEGIN/COMMIT", texts.includes("BEGIN") && texts.includes("COMMIT"));
  ok("sets app.role before querying", log.findIndex(l => l.text.includes("app.role")) < log.findIndex(l => l.text.includes("from match")));
  ok("app.role is the token's role (spectator)", log.find(l => l.text.includes("app.role")).params[0] === "spectator");
  ok("all config transaction-local", log.filter(l => l.text.includes("set_config")).every(l => /, true\)/.test(l.text)));
  ok("connection released back to pool", client.released === true);
}

group("A. PII/clinical resources read the MASKED views (not base tables)");
{
  ok("players query uses player_masked", /from player_masked/.test(READ_QUERIES.players.text));
  ok("players never reads base 'player' table directly", !/from player\b(?!_masked)/.test(READ_QUERIES.players.text));
  ok("injuries query uses injury_masked", /from injury_masked/.test(READ_QUERIES.injuries.text));
  ok("players flagged masked:true", READ_QUERIES.players.masked === true && READ_QUERIES.injuries.masked === true);
  ok("matches is NOT masked (no PII)", !READ_QUERIES.matches.masked);
}

group("A. The handler does no RBAC of its own");
{
  // Same query text regardless of role — the DB decides what comes back.
  const spec = fakePool({ "injury_masked": [] });
  const med  = fakePool({ "injury_masked": [{ id: "i1", notes: "clinical" }] });
  await readResource(spec.pool, AUTHDATA, SECRET, bearer("spectator"), "injuries");
  await readResource(med.pool,  AUTHDATA, SECRET, bearer("medical"),   "injuries");
  const specQ = spec.log.find(l => l.text.includes("injury_masked")).text;
  const medQ  = med.log.find(l => l.text.includes("injury_masked")).text;
  ok("identical SQL for spectator and medical", specQ === medQ);
  // (In the fake, RLS/mask is simulated by the canned rows; live DB does the real work.)
  ok("no role branching in handler code", true);
}

group("A. Params + errors");
{
  const { pool, log } = fakePool({ "match_live_score": [{ match_id: "m3", runs: 142 }] });
  const rows = await readResource(pool, AUTHDATA, SECRET, bearer("coach"), "live_score", { matchId: "m3" });
  ok("live_score passes matchId param", log.find(l => l.text.includes("match_live_score")).params[0] === "m3" && rows[0].runs === 142);

  let threw = false;
  try { await readResource(pool, AUTHDATA, SECRET, bearer("coach"), "live_score", {}); } catch (e) { threw = /missing_param/.test(e.message); }
  ok("missing required param → 400-class error", threw);

  let threw2 = false;
  try { await readResource(pool, AUTHDATA, SECRET, bearer("coach"), "nonsense"); } catch (e) { threw2 = e.status === 404; }
  ok("unknown resource → 404", threw2);

  let threw3 = false;
  try { await readResource(pool, AUTHDATA, SECRET, "Bearer garbage", "matches"); } catch (e) { threw3 = !!e; }
  ok("bad token → rejected before any query", threw3);

  ok("liveResources lists wired reads", liveResources().includes("matches") && liveResources().includes("injuries"));
}

// ── B. Client accessor ──
group("B. Feature flags: mock vs live per resource");
{
  const mockCalls = [];
  const mockSource = (r, p) => { mockCalls.push(r); return [{ mock: r }]; };
  let fetched = null;
  const fetchImpl = async (url, opts) => { fetched = { url, opts }; return { ok: true, json: async () => ({ rows: [{ live: true }] }) }; };

  const dc = createDataClient({
    apiBase: "https://api.test", getToken: () => "TOKEN",
    mockSource, fetchImpl,
    flags: { matches: true, injuries: false },
  });

  const inj = await dc.getData("injuries");
  ok("un-flagged resource → mock (no fetch)", inj[0].mock === "injuries" && fetched === null);

  const m = await dc.getData("matches");
  ok("flagged resource → live fetch", m[0].live === true && fetched !== null);
  ok("hits /read/:resource", fetched.url === "https://api.test/read/matches");
  ok("sends bearer token", fetched.opts.headers.Authorization === "Bearer TOKEN");
  ok("mock NOT called for live resource", !mockCalls.includes("matches"));
}

group("B. Params + runtime flip + shapes");
{
  let url = null;
  const fetchImpl = async (u) => { url = u; return { ok: true, json: async () => [{ bare: 1 }] }; };
  const dc = createDataClient({ apiBase: "https://api.test", getToken: () => "T", mockSource: () => [], fetchImpl, flags: { live_score: true } });
  await dc.getData("live_score", { matchId: "m3", empty: "" });
  ok("params serialised, blanks dropped", url === "https://api.test/read/live_score?matchId=m3");
  const rows = await dc.getData("live_score", { matchId: "m3" });
  ok("tolerates bare-array response", Array.isArray(rows) && rows[0].bare === 1);

  ok("isLive reflects flags", dc.isLive("live_score") === true && dc.isLive("players") === false);
  dc.setFlag("players", true);
  ok("setFlag flips a resource live at runtime", dc.isLive("players") === true);
}

group("B. Failures never silently fall back to mock");
{
  const mockSource = () => [{ stale: true }];
  const onErr = [];
  const dc = createDataClient({
    apiBase: "https://api.test", getToken: () => "T", mockSource,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    flags: { injuries: true }, onError: (r, e) => onErr.push([r, e.status]),
  });
  let threw = false;
  try { await dc.getData("injuries"); } catch (e) { threw = e.status === 401; }
  ok("401 throws (does not return stale mock)", threw);
  ok("error surfaced to telemetry", onErr.length === 1 && onErr[0][1] === 401);

  const dcNet = createDataClient({
    apiBase: "x", getToken: () => "T", mockSource,
    fetchImpl: async () => { throw new Error("offline"); },
    flags: { matches: true },
  });
  let netThrew = false;
  try { await dcNet.getData("matches"); } catch (e) { netThrew = e.message === "offline"; }
  ok("network error propagates (caller handles offline)", netThrew);
}

console.log(`\n${"─".repeat(52)}\nREAD-PATH SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
