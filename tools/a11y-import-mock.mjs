/**
 * An API for smoke-a11y to put Settings → Import and the Staff screen in front of.
 *
 * smoke-a11y runs against the built bundle with no server and no database.
 * Both screens exist only for a signed-in person who holds the capability, so
 * the walk would never see them. This serves, from memory and over Playwright's
 * `page.route`, what they read and post: the school office's session, the
 * `users` and `assignments` reads (a coach, a scorer, a physio, a director of
 * sport who is also a parent, and a parent), and the importer: a dry run that
 * reports one bad line for a file with a day/month birthday in it and is clean
 * for any other, and a commit. Every other read answers with no rows.
 *
 * It is NOT an authorization layer and proves nothing about who may import or
 * read what: that is tools/smoke-browser-import.mjs's, against the real stack.
 * All it has to do is put the screens on a page so the accessibility ratchets
 * can count what is drawn. Every name is invented.
 */
const HIL = "11111111-1111-1111-1111-111111111111";
const id = (n) => `88888888-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;

/** @returns {(method: string, pathname: string, search: URLSearchParams, body?: any) => { status: number, body: any }} */
export function importApi() {
  const people = [
    [4, "C Hendricks", "coach", "coach@example.invalid", ["1XI"]],
    [6, "A Wessels", "scorer", "scorer@example.invalid", ["1XI"]],
    [3, "L van Wyk", "medical", "medical@example.invalid", []],
    [7, "Sarah Mokoena", "directorofsport", "sarah@example.invalid", ["U16A"]],
    [5, "D Pillay", "parent", "parent@example.invalid", []],
  ];
  const users = people.map(([n, name, role, email, teams]) => ({ id: id(n), school_id: HIL, email, name, role, active: true, last_seen_at: "2026-10-02T07:30:00Z", teams, player_id: null }));
  const as = (n, name, role, team = null) => ({ id: `a5510000-0000-0000-0000-${String(n).padStart(12, "0")}`, person_id: id(n), person_name: name, role, school_id: HIL, team_code: team,
    fixture_id: null, active: true, valid_from: null, valid_until: null, created_at: "2026-09-01T08:00:00Z", created_by: null, granted_by_name: "B Naicker",
    revoked_at: null, revoked_by: null, revoked_by_name: null, suspended: false });
  const assignments = [as(4, "C Hendricks", "coach", "1XI"), as(6, "A Wessels", "scorer", "1XI"), as(3, "L van Wyk", "medical"),
    as(7, "Sarah Mokoena", "directorofsport"), as(7, "Sarah Mokoena", "guardian"), as(7, "Sarah Mokoena", "coach", "U16B"), as(5, "D Pillay", "guardian")];
  const session = {
    user: { id: id(2), name: "B Naicker", email: "registrar@example.invalid" }, deviceId: "dev-a11y-import",
    assignments: [{ id: "a5510000-0000-0000-0000-0000000000a1", role: "schooladmin", school: HIL, schoolName: "Hilton College", team: null, season: null, fixture: null, from: null, until: null,
      expiresAt: null, subjects: [], children: [] }],
  };

  /** @type {Record<string, () => any[]>} */
  const reads = {
    users: () => users,
    assignments: () => assignments,
    my_features: () => [{ key: "analytics", kind: "module", label: "Analytics", enabled: true }, { key: "sport_cricket", kind: "sport", label: "Cricket", enabled: true }],
    sports: () => [{ code: "cricket", label: "Cricket", engine: "scoring", flag_key: "sport_cricket", enabled: true, fixtures: 0 }],
  };

  return (method, pathname, _search, body) => {
    if (pathname === "/api/health") return { status: 200, body: { ok: true, db: "ok", ai: "no_credentials", auth: "dev_login_enabled", read: [], write: "mounted", handover: "mounted", public: "off", pages: "local", reader: "none" } };
    if (pathname === "/api/auth/dev-login") return { status: 200, body: { token: "a11y-import-token" } };
    if (pathname === "/api/session") return { status: 200, body: session };
    if (pathname === "/api/competition-invitations") return { status: 200, body: { invitations: [] } };
    if (pathname === "/api/import/players" && method === "POST") {
      const bad = String(body?.csv ?? "").includes("09/08/2012");
      const errors = bad ? [{ line: 3, column: "born", message: "must be a date like 2011-04-07 (day/month order is ambiguous and is not guessed)" }] : [];
      return { status: 200, body: body?.commit === true && !bad
        ? { kind: "players", committed: true, rows: 3, inserted: 3, updated: 0, errors: [], unknownColumns: [], warnings: [], clean: true }
        : { kind: "players", committed: false, rows: bad ? 2 : 3, wouldInsert: bad ? 2 : 3, wouldUpdate: 0, errors, unknownColumns: [], warnings: [], clean: !bad } };
    }
    const read = /^\/api\/read\/([a-z_]+)$/.exec(pathname);
    if (read) return { status: 200, body: { resource: read[1], rows: reads[read[1]]?.() ?? [] } };
    return { status: 404, body: { error: "not_found" } };
  };
}
