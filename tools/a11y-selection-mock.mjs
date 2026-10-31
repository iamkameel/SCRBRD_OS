/**
 * An API for smoke-a11y to put the union selector's Selection screen in front
 * of (docs/design/UNION_SELECTOR_FIND.md S3).
 *
 * smoke-a11y runs against the built bundle with no server and no database.
 * Selection exists only for a signed-in person holding passport.union.read,
 * so the walk would never see it. This serves, from memory and over
 * Playwright's `page.route`, what it reads: a selector's session at two
 * institutions (his union and CSA Schools, so the chip is drawn), the schools,
 * a list of three boys, one boy's name and passport lines, and a second boy
 * whose door is shut (his name answered null), so "No longer open" is drawn.
 *
 * It is NOT an authorization layer and proves nothing about who is listed:
 * that is tools/smoke-passport.mjs's and tools/smoke-browser-passport-union.mjs's,
 * against the real stack. Every name is invented.
 */
const UNION = "c0000000-0000-0000-0000-0000000000a1";
const FED = "c0000000-0000-0000-0000-0000000000f1";
const SCHOOL = "11111111-1111-1111-1111-111111111111";
const OPEN = "b0000000-0000-0000-0000-000000000001";
const SHUT = "b0000000-0000-0000-0000-000000000002";

export function selectionApi() {
  const session = {
    user: { id: "88888888-0000-0000-0000-0000000000a1", name: "Verify Selector", email: "selector@example.invalid" }, deviceId: "dev-a11y-selection",
    assignments: [
      { id: "a5510000-0000-0000-0000-0000000000a1", role: "unionselector", school: UNION, schoolName: "Verify Union", team: null, season: null, fixture: null, from: null, until: null, expiresAt: null, subjects: [], children: [] },
      { id: "a5510000-0000-0000-0000-0000000000a2", role: "unionselector", school: FED, schoolName: "Verify Federation", team: null, season: null, fixture: null, from: null, until: null, expiresAt: null, subjects: [], children: [] },
    ],
  };
  const boys = [
    { player_id: OPEN, name: "Verify Boy A", school_name: "Verify High", team_code: "U15A", org_id: UNION, consent_id: "c1000000-0000-0000-0000-000000000001" },
    { player_id: SHUT, name: "Verify Boy B", school_name: "Verify High", team_code: "U15B", org_id: UNION, consent_id: "c1000000-0000-0000-0000-000000000002" },
    { player_id: "b0000000-0000-0000-0000-000000000003", name: "Verify Boy With A Rather Longer Name Than Most", school_name: "Verify High", team_code: "1XI", org_id: UNION, consent_id: "c1000000-0000-0000-0000-000000000003" },
  ];
  /** @type {Record<string, (s: URLSearchParams) => any[]>} */
  const reads = {
    passport_union_orgs: () => [{ org_id: UNION, name: "Verify Union", kind: "union" }, { org_id: FED, name: "Verify Federation", kind: "federation" }],
    passport_union_schools: () => [{ school_id: SCHOOL, name: "Verify High" }],
    passport_union_list: (s) => (s.get("q") === "nobody" ? [] : boys),
    passport_name: (s) => [{ name: s.get("playerId") === OPEN ? "Verify Boy A" : null }],
    passport: (s) => (s.get("playerId") !== OPEN ? [] : [
      { family: "career", label: "Batting", value: "212 runs in 9 innings, average 30.3", on_date: null, source_school: "Verify High", recorded_by: "the match record", confidence: "derived" },
      { family: "cap", label: "U15A cap #12", value: "9 appearances", on_date: "2026-02-01", source_school: "Verify High", recorded_by: "the team sheets", confidence: "derived" },
      { family: "honour", label: "Player of the Match", value: "2026", on_date: "2026-03-01", source_school: "Verify High", recorded_by: "nobody on record", confidence: "seeded" },
    ]),
  };
  const handle = (/** @type {string} */ _method, /** @type {string} */ pathname, /** @type {URLSearchParams} */ search) => {
    if (pathname === "/api/health") return { status: 200, body: { ok: true, db: "ok", ai: "no_credentials", auth: "dev_login_enabled", read: [], write: "mounted", handover: "mounted", public: "on", pages: "local", reader: "none" } };
    if (pathname === "/api/auth/dev-login") return { status: 200, body: { token: "a11y-selection-token" } };
    if (pathname === "/api/session") return { status: 200, body: session };
    if (pathname === "/api/competition-invitations") return { status: 200, body: { invitations: [] } };
    const read = /^\/api\/read\/([a-z_]+)$/.exec(pathname);
    if (read) return { status: 200, body: { resource: read[1], rows: reads[read[1]]?.(search) ?? [] } };
    return { status: 404, body: { error: "not_found" } };
  };
  return { handle };
}

export { OPEN, SHUT, UNION };
