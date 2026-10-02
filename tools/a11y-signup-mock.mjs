/**
 * An API for smoke-a11y to put the sign-in screens in front of (SCRBRD-140 phase 1).
 *
 * smoke-a11y runs against a built bundle with no server and no database. The
 * Google block on the sign-in screen, the no-school screen, Me's ways to sign
 * in and the office's Claims list exist only for a signed-in person, so the
 * walk would never see them. This serves, from memory and over Playwright's
 * `page.route`, what those screens read: a session by who is signed in
 * (`handle.who`), the schools, a pending request, the help link, one Google
 * sign-in and one claim. Every other read answers with no rows.
 *
 * It is NOT an authorization layer and proves nothing about who may see what
 * (tools/smoke-signup.mjs and tools/smoke-browser-signup.mjs are that, against
 * the real stack). It only puts the screens on a page so the accessibility
 * ratchets can count what is drawn. Every name is invented.
 */
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";

/** @returns {((method: string, pathname: string, search: URLSearchParams) => { status: number, body: any }) & { who: string, exchange: string }} */
export function signupApi() {
  const people = {
    newcomer: { user: { id: "88888888-0000-0000-0000-0000000000f1", name: "Walk Newcomer", email: "walk.newcomer@example.invalid" }, assignments: [] },
    coach: { user: { id: "88888888-0000-0000-0000-000000000004", name: "C Hendricks", email: "coach@example.invalid" },
      assignments: [{ id: "a5510000-0000-0000-0000-000000000004", role: "coach", school: HIL, schoolName: "Hilton College", team: "1XI", season: null, fixture: null, from: null, until: null, expiresAt: null, subjects: [], children: [] }] },
    office: { user: { id: "88888888-0000-0000-0000-0000000000a1", name: "B Naicker", email: "registrar@example.invalid" },
      assignments: [{ id: "a5510000-0000-0000-0000-0000000000a1", role: "schooladmin", school: HIL, schoolName: "Hilton College", team: null, season: null, fixture: null, from: null, until: null, expiresAt: null, subjects: [], children: [] }] },
  };
  const requested = [];

  /** @type {Record<string, () => any[]>} */
  const reads = {
    role_requests: () => requested,
    my_sign_ins: () => [{ id: "51000000-0000-0000-0000-000000000001", provider: "google.com", email_at_link: "coach@example.invalid", linked_at: "2026-10-01T08:00:00Z",
      linked_how: "office_confirmed", last_sign_in_at: "2026-10-02T07:30:00Z", revoked_at: null },
      { id: "51000000-0000-0000-0000-000000000002", provider: "google.com", email_at_link: "old.address@example.invalid", linked_at: "2026-09-01T08:00:00Z",
      linked_how: "self_added", last_sign_in_at: null, revoked_at: "2026-09-20T08:00:00Z" }],
    sign_in_claims: () => [{ id: "c1a10000-0000-0000-0000-000000000001", user_id: "88888888-0000-0000-0000-000000000005", account_name: "D Pillay", account_email: "parent@example.invalid",
      account_active: true, school_id: HIL, presented_email: "parent.other@example.invalid", provider: "google.com", requested_at: "2026-10-02T08:00:00Z", last_requested_at: "2026-10-02T09:00:00Z" }],
    my_features: () => [{ key: "analytics", kind: "module", label: "Analytics", enabled: true }, { key: "sport_cricket", kind: "sport", label: "Cricket", enabled: true }],
    sports: () => [{ code: "cricket", label: "Cricket", engine: "scoring", flag_key: "sport_cricket", enabled: true, fixtures: 0 }],
  };

  const handle = Object.assign((/** @type {string} */ method, /** @type {string} */ pathname) => {
    if (pathname === "/api/health") return { status: 200, body: { ok: true, db: "ok", ai: "no_credentials", auth: "dev_login_enabled", read: [], write: "mounted", handover: "mounted", public: "off", pages: "local", reader: "none" } };
    if (pathname === "/api/auth/dev-login") return { status: 200, body: { token: "a11y-signup-token" } };
    if (pathname === "/api/auth/firebase") {
      if (handle.exchange === "claim") return { status: 409, body: { error: "claim_required" } };
      return { status: 200, body: { token: "a11y-signup-token", outcome: "new_account" } };
    }
    if (pathname === "/api/session") return { status: 200, body: { ...people[/** @type {keyof typeof people} */ (handle.who)], deviceId: "dev-a11y-signup" } };
    if (pathname === "/api/schools") return { status: 200, body: { rows: [{ id: HIL, name: "Hilton College" }, { id: WES, name: "Westville Boys' High" }] } };
    if (pathname === "/api/safeguarding/contacts") return { status: 200, body: { rows: [], guardianAppUrl: "https://example.invalid/the-guardian" } };
    if (pathname === "/api/requests" && method === "POST") {
      requested.push({ id: "r1000000-0000-0000-0000-000000000001", person_id: people.newcomer.user.id, name: "Walk Newcomer", email: "walk.newcomer@example.invalid", role: "guardian",
        school_id: HIL, school_name: "Hilton College", team_code: null, player_id: null, note: "Child: Test Child · Relationship: Mother", state: "pending", requested_at: "2026-10-02T10:00:00Z",
        decided_at: null, decided_note: null, decided_by_name: null, mine: true, decidable: false });
      return { status: 200, body: { id: "r1000000-0000-0000-0000-000000000001", state: "pending" } };
    }
    if (pathname === "/api/competition-invitations") return { status: 200, body: { invitations: [] } };
    const read = /^\/api\/read\/([a-z_]+)$/.exec(pathname);
    if (read) return { status: 200, body: { resource: read[1], rows: reads[read[1]]?.() ?? [] } };
    return { status: 404, body: { error: "not_found" } };
  }, { who: "newcomer", exchange: "claim" });
  return handle;
}
