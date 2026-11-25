/**
 * An API for smoke-a11y to put the parent's terms card, the sheet it opens and
 * the line that follows her agreement in front of (GA-I20 D7).
 *
 * smoke-a11y runs against the built bundle with no server and no database.
 * The card exists only for a signed-in parent whose own verified link has not
 * agreed the school's terms, so the walk would never see it. This serves, from
 * memory and over Playwright's `page.route`, what the family screens read and
 * post: a parent's session at one school, her one child behind the terms
 * (my_children), the school's DSO, and POST /api/players/:id/guardians/consent,
 * which records the agreement with the server's own clock, as
 * guardian_consent_record() does. Every other read answers with no rows.
 *
 * It is NOT an authorization layer and proves nothing about who may agree or
 * what a parent may read: that is tools/smoke-browser-read.mjs's, against the
 * real stack. All it has to do is put the screens on a page so the
 * accessibility ratchets can count what is drawn. Every name is invented.
 */
const HIL = "11111111-1111-1111-1111-111111111111";
const CHILD = "aaaaaaaa-0000-0000-0000-0000000000f5";

/** @returns {{ handle: (method: string, pathname: string, search: URLSearchParams, body?: any) => { status: number, body: any }, state: { consent: string, version: string | null, at: string | null } }} */
export function termsApi() {
  const state = { consent: "pending", version: /** @type {string | null} */ (null), at: /** @type {string | null} */ (null) };
  const session = {
    user: { id: "88888888-0000-0000-0000-0000000000f5", name: "N Verify", email: "parent.verify@example.invalid" }, deviceId: "dev-a11y-terms",
    assignments: [{ id: "a5510000-0000-0000-0000-0000000000f5", role: "guardian", school: HIL, schoolName: "Hilton College", team: null, season: null, fixture: null,
      from: null, until: null, expiresAt: null, subjects: [CHILD], children: [CHILD] }],
  };
  /** @type {Record<string, () => any[]>} */
  const reads = {
    my_children: () => [{ player_id: CHILD, full_name: "K Verify", known_as: null, team_code: "U15A", school_id: HIL, school_name: "Hilton College", school_kind: "school",
      relationship: "parent", verification_state: "verified", consent_state: state.consent, consent_version: state.version, consent_at: state.at,
      valid_from: "2026-01-12", valid_until: null }],
    my_features: () => [{ key: "sport_cricket", kind: "sport", label: "Cricket", enabled: true }],
    sports: () => [{ code: "cricket", label: "Cricket", engine: "scoring", flag_key: "sport_cricket", enabled: true, fixtures: 0 }],
  };
  const handle = (/** @type {string} */ method, /** @type {string} */ pathname, /** @type {URLSearchParams} */ _search, /** @type {any} */ body) => {
    if (pathname === "/api/health") return { status: 200, body: { ok: true, db: "ok", ai: "no_credentials", auth: "dev_login_enabled", read: [], write: "mounted", handover: "mounted", public: "off", pages: "local", reader: "none" } };
    if (pathname === "/api/auth/dev-login") return { status: 200, body: { token: "a11y-terms-token" } };
    if (pathname === "/api/session") return { status: 200, body: session };
    if (pathname === "/api/competition-invitations") return { status: 200, body: { invitations: [] } };
    if (pathname === "/api/lifts/mine") return { status: 200, body: { rows: [] } };
    if (pathname === "/api/safeguarding/contacts") {
      return { status: 200, body: { rows: [{ schoolId: HIL, schoolName: "Hilton College", personId: "88888888-0000-0000-0000-0000000000f6", name: "P Verify", heldAt: "school" }], guardianAppUrl: null } };
    }
    if (pathname === `/api/players/${CHILD}/guardians/consent` && method === "POST") {
      if (!body?.consentVersion) return { status: 403, body: { error: "no_consent_version" } };
      Object.assign(state, { consent: "granted", version: body.consentVersion, at: new Date().toISOString() });
      return { status: 200, body: { ok: true, reason: null } };
    }
    const read = /^\/api\/read\/([a-z_]+)$/.exec(pathname);
    if (read) return { status: 200, body: { resource: read[1], rows: reads[read[1]]?.() ?? [] } };
    return { status: 404, body: { error: "not_found" } };
  };
  return { handle, state };
}

export { CHILD };
