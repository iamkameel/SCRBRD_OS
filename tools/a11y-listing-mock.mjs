/**
 * An API for smoke-a11y to put the school's listing switch, the fixture
 * panel's listing line and Fields → Add ground in front of.
 *
 * smoke-a11y runs against the built bundle with no server and no database.
 * These screens exist only for a signed-in person whose assignment grants
 * broadcast.publish and facility.manage, so the walk would never see them.
 * This serves, from memory and over Playwright's `page.route`, what they read
 * and post: the director of sport's session at Hilton, one fixture today, its
 * publication (the home side, publishable), the school's listing (GET, and POST
 * which flips it), two grounds (a field and a pitch on it) and POST /api/grounds,
 * which refuses a name the school already has, as groundCreate does. `state` is
 * the walk's to change: `mayChange: false` makes the switch a reader's.
 *
 * It is NOT an authorization layer and proves nothing about who may list or add
 * a ground: that is tools/smoke-browser-listing.mjs's, against the real stack.
 * All it has to do is put the screens on a page so the accessibility ratchets
 * can count what is drawn. Every name is invented.
 */
const HIL = "11111111-1111-1111-1111-111111111111";
const MATCH = "dd000000-0000-0000-0000-000000000001";

/** @returns {{ handle: (method: string, pathname: string, search: URLSearchParams, body?: any) => { status: number, body: any }, state: { listed: boolean, mayChange: boolean } }} */
export function listingApi() {
  const state = { listed: false, mayChange: true };
  const grounds = [
    { id: "ee000000-0000-0000-0000-000000000001", school_id: HIL, name: "Verify Oval", surface: "grass", parent_id: null, end_a_name: null, end_b_name: null },
    { id: "ee000000-0000-0000-0000-000000000002", school_id: HIL, name: "Verify Pitch 1", surface: "turf", parent_id: "ee000000-0000-0000-0000-000000000001", end_a_name: null, end_b_name: null },
  ];
  const sa = new Date(Date.now() + 2 * 3600e3);
  const today = new Date(Date.UTC(sa.getUTCFullYear(), sa.getUTCMonth(), sa.getUTCDate(), 10, 0, 0)).toISOString();
  const match = {
    id: MATCH, school_id: HIL, team_code: "1XI", opponent: "Verify Visitors 1XI", starts_at: today, format: "T20", overs: 20, status: "scheduled",
    season: String(sa.getUTCFullYear()), sport: "cricket", away_school_id: null, away_team_code: null, competition_id: null,
    home_label: "Hilton College 1XI", away_label: null, home_code: "HIL", away_code: null, my_side: "home",
    toss_won_by: null, toss_decision: null, bats_first: null, toss_at: null, ground: "Verify Oval", ground_end_a: null, ground_end_b: null,
  };
  let published = false;
  const session = {
    user: { id: "88888888-0000-0000-0000-000000000007", name: "Sarah Mokoena", email: "sarah@example.invalid" }, deviceId: "dev-a11y-listing",
    assignments: [{ id: "a5510000-0000-0000-0000-0000000000d7", role: "directorofsport", school: HIL, schoolName: "Hilton College", team: null, season: null, fixture: null, from: null, until: null,
      expiresAt: null, subjects: [], children: [] }],
  };
  /** @type {Record<string, () => any[]>} */
  const reads = {
    grounds: () => grounds,
    matches: () => [match],
    my_features: () => [{ key: "analytics", kind: "module", label: "Analytics", enabled: true }, { key: "sport_cricket", kind: "sport", label: "Cricket", enabled: true }],
    sports: () => [{ code: "cricket", label: "Cricket", engine: "scoring", flag_key: "sport_cricket", enabled: true, fixtures: 1 }],
  };
  const handle = (/** @type {string} */ method, /** @type {string} */ pathname, /** @type {URLSearchParams} */ _search, /** @type {any} */ body) => {
    if (pathname === "/api/health") return { status: 200, body: { ok: true, db: "ok", ai: "no_credentials", auth: "dev_login_enabled", read: [], write: "mounted", handover: "mounted", public: "on", pages: "local", reader: "none" } };
    if (pathname === "/api/auth/dev-login") return { status: 200, body: { token: "a11y-listing-token" } };
    if (pathname === "/api/session") return { status: 200, body: session };
    if (pathname === "/api/competition-invitations") return { status: 200, body: { invitations: [] } };
    if (pathname === `/api/schools/${HIL}/public-names`) return { status: 404, body: { error: "not_found" } };
    if (pathname === `/api/schools/${HIL}/listing`) {
      if (method === "POST") { state.listed = body?.listed === true; return { status: 200, body: { ok: true, schoolId: HIL, listed: state.listed } }; }
      return { status: 200, body: { schoolId: HIL, listed: state.listed, setAt: null, mayChange: state.mayChange } };
    }
    if (pathname === `/api/matches/${MATCH}/publication`) {
      if (method === "POST") { published = body?.published === true; return { status: 200, body: { ok: true, side: "home", published } }; }
      return { status: 200, body: { matchId: MATCH, sides: [
        { side: "home", published, on_platform: true, may_publish: true, names: { named: 0, positions: 0, total: 0 } },
        { side: "away", published: false, on_platform: false, may_publish: false, names: null }] } };
    }
    if (pathname === "/api/grounds" && method === "POST") {
      const name = String(body?.name ?? "").trim().replace(/\s+/g, " ");
      const same = grounds.find((g) => g.school_id === body?.schoolId && g.name.toLowerCase() === name.toLowerCase());
      if (same) return { status: 409, body: { error: "ground_exists", detail: same.id } };
      const g = { id: `ee000000-0000-0000-0000-0000000000${String(grounds.length + 1).padStart(2, "0")}`, school_id: body.schoolId, name, surface: body.surface ?? null, parent_id: body.parentId ?? null, end_a_name: null, end_b_name: null };
      grounds.push(g);
      return { status: 200, body: { id: g.id, schoolId: g.school_id, name: g.name, surface: g.surface, parentId: g.parent_id } };
    }
    const read = /^\/api\/read\/([a-z_]+)$/.exec(pathname);
    if (read) return { status: 200, body: { resource: read[1], rows: reads[read[1]]?.() ?? [] } };
    return { status: 404, body: { error: "not_found" } };
  };
  return { handle, state };
}

export { MATCH };
