/**
 * The planner's drafts are what the fixture route accepts (SCRBRD-123).
 *
 * toFixtureDrafts() (packages/scoring/src/planner.mjs) promises a body POST
 * /api/fixtures takes as it stands, so that publishing a plan (phase 2) is a
 * loop over the existing route and not a second way to make a fixture. The
 * route's validation is inline in its handler, not a validator it exports,
 * so this suite runs the handler itself — fixtureRoutes().create — over a
 * fake database, with a signed token: every check the route makes before
 * the insert runs on each draft, and the insert's parameters are compared
 * with the draft field by field.
 *
 * What the database decides (match_insert in db/09: may this person arrange
 * a fixture for that school; match_competition_entered() in db/61: did both
 * sides enter the competition) is not here; tools/smoke-* walks hold those
 * against a real database.
 *
 *   node services/api/write/planner-drafts.test.mjs
 */
import { fixtureRoutes } from "./fixture-api.mjs";
import { signToken } from "../auth/auth.mjs";
import { pairings, plan, toFixtureDrafts, PLAN_FORMAT } from "@scrbrd/scoring/planner";
/** @import { Pool, ApiResponse } from "../api-types.mjs" */

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const SECRET = "planner-drafts-secret";
const bearer = `Bearer ${signToken({ userId: "00000000-0000-4000-8000-0000000000aa", deviceId: "desk" }, SECRET)}`;

/**
 * A pool whose one statement of interest is the insert: it records the
 * parameters and returns the row Postgres would, echoing them. Everything
 * else (BEGIN, the session settings, COMMIT) answers with nothing.
 * @param {any[][]} inserts
 * @returns {Pool}
 */
function fakePool(inserts) {
  const client = {
    query: async (/** @type {string} */ text, /** @type {any[]} */ params = []) => {
      if (!/insert into match/i.test(text)) return { rows: [] };
      inserts.push(params);
      const [school_id, team_code, away_school_id, away_team_code, opponent, ground_id, starts_at, sport, format, overs, status, competition_id] = params;
      return { rows: [{ id: `m${inserts.length}`, school_id, team_code: String(team_code).trim(), away_school_id, away_team_code,
                        opponent, ground_id, starts_at, sport, format, overs, status, competition_id }] };
    },
    release: () => {},
  };
  return { query: client.query, connect: async () => client };
}

/**
 * Post a body through the route's handler.
 * @param {ReturnType<typeof fixtureRoutes>} routes @param {unknown} body
 * @returns {Promise<{ status: number, body: any }>}
 */
async function post(routes, body) {
  let status = 200, out = null;
  /** @type {ApiResponse} */
  const res = { status: (c) => { status = c; return res; }, json: (b) => { out = b; return res; } };
  await routes.create({ params: {}, body, headers: { authorization: bearer } }, res);
  return { status, body: out };
}

const COMP = "7c1c1f5e-9b1a-4b7e-8d0e-2f1f3f9b8a01";
const school = (/** @type {number} */ i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const ground = (/** @type {number} */ i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;
const entrants = Array.from({ length: 5 }, (_, i) => ({ id: `e${i + 1}`, schoolId: school(i + 1), teamCode: i === 4 ? " U15A " : "1st XI" }));
const at = (/** @type {string} */ day, /** @type {string} */ hhmm) => new Date(Date.parse(`${day}T${hhmm}:00+02:00`)).toISOString();

group("A. Every draft of a planned league passes the route");
{
  const draw = pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants });
  const windows = ["2026-10-03", "2026-10-10", "2026-10-17", "2026-10-24", "2026-10-31"].flatMap((d, i) => [
    { id: `w${i}a`, groundId: ground(1), startsAt: at(d, "09:00"), endsAt: at(d, "13:00") },
    { id: `w${i}b`, groundId: ground(2), startsAt: at(d, "09:00"), endsAt: at(d, "13:00") },
  ]);
  const p = plan({ pairings: draw, windows, rules: { durationMinutes: 180, preparationMinutes: 30 } });
  ok("(all ten placed)", p.placed === 10, p.fixtures.map((f) => f.reasons));

  for (const [label, competition] of /** @type {const} */ ([
    ["the competition's format", { id: COMP, format: "T20", entrants }],
    ["conditions of fifty overs", { id: COMP, format: "T20", conditions: { "format.overs_per_innings": 50 }, entrants }],
    ["nothing said about the format", { id: COMP, entrants }],
  ])) {
    const { drafts } = toFixtureDrafts(p, competition);
    const inserts = /** @type {any[][]} */ ([]);
    const routes = fixtureRoutes({ pool: fakePool(inserts), secret: SECRET });
    let accepted = 0, faithful = 0;
    for (const d of drafts) {
      const r = await post(routes, d.body);
      if (r.status === 200 && r.body?.id) accepted++;
      const [schoolId, teamCode, awaySchool, awayTeam, , groundId, startsAt, sport, , , status, competitionId] = inserts.at(-1) ?? [];
      if (schoolId === d.body.schoolId && teamCode === d.body.teamCode && awaySchool === d.body.awaySchoolId
          && awayTeam === d.body.awayTeamCode && groundId === d.body.groundId && startsAt === d.body.startsAt
          && sport === "cricket" && status === "scheduled" && competitionId === COMP
          && r.body?.sharedWithOpponent === true) faithful++;
    }
    ok(`${label}: all ten drafts accepted`, accepted === 10 && drafts.length === 10, accepted);
    ok(`${label}: the insert carries each draft as it was, the competition on every one`, faithful === 10, faithful);
    const formats = new Set(inserts.map((x) => `${x[8]}/${x[9]}`));
    ok(`${label}: the format and overs the route stored`, formats.size === 1, [...formats]);
    if (label === "the competition's format") ok("  T20, 20 overs (the route's default overs)", formats.has("T20/20"), [...formats]);
    if (label === "conditions of fifty overs") ok("  One-Day, 50 overs", formats.has("One-Day/50"), [...formats]);
    if (label === "nothing said about the format") ok("  the route's own default, T20 and 20", formats.has("T20/20"), [...formats]);
  }
}

group("B. The harness is the route's validation, and it can refuse");
{
  const draw = pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants: entrants.slice(0, 2) });
  const p = plan({ pairings: draw, windows: [{ id: "w", groundId: ground(1), startsAt: at("2026-10-03", "09:00"), endsAt: at("2026-10-03", "13:00") }],
                   rules: { durationMinutes: 180 } });
  const [d] = toFixtureDrafts(p, { id: COMP, entrants }).drafts;
  const routes = fixtureRoutes({ pool: fakePool([]), secret: SECRET });
  /** @param {Record<string, unknown>} change */
  const refusedAs = async (change) => (await post(routes, { ...d.body, ...change })).body?.error;
  ok("no team: team_required", await refusedAs({ teamCode: "" }) === "team_required");
  ok("no away team: away_team_required", await refusedAs({ awayTeamCode: undefined }) === "away_team_required");
  ok("an opponent typed as well: name_the_away_side_once", await refusedAs({ opponent: "Michaelhouse" }) === "name_the_away_side_once");
  ok("a competition that is not a uuid: competition_invalid", await refusedAs({ competitionId: "league-1" }) === "competition_invalid");
  ok("no start: starts_at_required", await refusedAs({ startsAt: undefined }) === "starts_at_required");
  const unsigned = { status: 200, body: /** @type {any} */ (null) };
  /** @type {ApiResponse} */
  const res = { status: (c) => { unsigned.status = c; return res; }, json: (b) => { unsigned.body = b; return res; } };
  await routes.create({ params: {}, body: d.body, headers: {} }, res);
  ok("no token: 401 missing_token, before the database", unsigned.status === 401 && unsigned.body?.error === "missing_token", unsigned);
  ok("the draft never sends `opponent` (the trigger stamps it)", !("opponent" in d.body));
}

group("C. A knockout's later round is posted once the earlier result names a winner (SCRBRD-114 phase 3c)");
{
  const four = entrants.slice(0, 4);
  const draw = pairings({ format: PLAN_FORMAT.KNOCKOUT, entrants: four });
  const windows = ["2026-10-03", "2026-10-10"].flatMap((d, i) => [
    { id: `k${i}a`, groundId: ground(1), startsAt: at(d, "09:00"), endsAt: at(d, "13:00") },
    { id: `k${i}b`, groundId: ground(2), startsAt: at(d, "09:00"), endsAt: at(d, "13:00") },
  ]);
  const p = plan({ pairings: draw, windows, rules: { durationMinutes: 180, preparationMinutes: 30 } });
  const final = /** @type {any} */ (p.fixtures.find((f) => "winnerOf" in f.home || "winnerOf" in f.away));
  ok("(the final names the semi-finals' winners, and is placed)", final && final.windowId != null, final);
  const before = toFixtureDrafts(p, { id: COMP, format: "T20", entrants });
  ok("no result yet: the final is held, awaiting_winner", before.held.some((h) => h.fixtureId === final.id && h.reason === "awaiting_winner")
     && !before.drafts.some((d) => d.fixtureId === final.id), before.held);
  // One semi-final has a winner, the other not yet: still held.
  const semiA = final.home.winnerOf, semiB = final.away.winnerOf;
  const sideOf = (/** @type {string} */ id) => /** @type {any} */ (p.fixtures.find((f) => f.id === id)).home.entrant;
  const half = toFixtureDrafts(p, { id: COMP, format: "T20", entrants, resolved: { [semiA]: sideOf(semiA) } });
  ok("one semi-final decided: still held", half.held.some((h) => h.fixtureId === final.id && h.reason === "awaiting_winner"), half.held);
  // Both decided: posted, with the winners as its sides, and where each came from.
  const both = toFixtureDrafts(p, { id: COMP, format: "T20", entrants, resolved: { [semiA]: sideOf(semiA), [semiB]: sideOf(semiB) } });
  const d = both.drafts.find((x) => x.fixtureId === final.id);
  const homeE = /** @type {any} */ (entrants.find((e) => e.id === sideOf(semiA))), awayE = /** @type {any} */ (entrants.find((e) => e.id === sideOf(semiB)));
  ok("both decided: the final is a draft, the winners its sides", d && d.body.schoolId === homeE.schoolId && d.body.awaySchoolId === awayE.schoolId, d);
  ok("...and it says where each side came from", JSON.stringify(d?.progression) === JSON.stringify([{ side: "home", fromFixture: semiA }, { side: "away", fromFixture: semiB }]), d?.progression);
  const inserts = /** @type {any[][]} */ ([]);
  const r = await post(fixtureRoutes({ pool: fakePool(inserts), secret: SECRET }), /** @type {any} */ (d).body);
  ok("...and the fixture route accepts it as it stands", r.status === 200 && r.body?.id && inserts.length === 1, r);
  const plain = both.drafts.filter((x) => x.fixtureId !== final.id);
  ok("a fixture of entrants alone carries no progression", plain.length === 2 && plain.every((x) => x.progression.length === 0), plain.map((x) => x.progression));
}

console.log("\n" + "─".repeat(52));
console.log(`PLANNER DRAFTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
