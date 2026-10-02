/**
 * An API for smoke-a11y to point a signed-in pupil at (SCRBRD-138 phase A).
 *
 * smoke-a11y runs against the built bundle with no server and no database. The
 * captain's view exists only for a signed-in pupil holding the honour, so the
 * walk would never see it. This serves, from memory and over Playwright's
 * `page.route`, the handful of routes that pupil's Home, fixture screen and
 * Match Centre read: his session, his side, his honour, three fixtures, and
 * the two live ball logs of tools/fixture-captain.mjs (the same events the
 * pupil walk writes to the database). Every other read answers with no rows.
 *
 * It is NOT an authorization layer and proves nothing about who may read what:
 * that is tools/smoke-browser-pupil.mjs's, against the real stack. All it has
 * to do is put the screens on a page so the accessibility ratchets can count
 * what is drawn. Every name is invented.
 */
import { toRow } from "@scrbrd/scoring";
import { captainLogs, PLAY, SOURCES } from "./fixture-captain.mjs";

const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const PLAYERS = {
  pillay:    { id: "aaaaaaaa-0000-0000-0000-000000000005", name: "R Pillay",      no: 5, role: "allrounder" },
  whitfield: { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "James Whitfield", no: 1, role: "batter" },
  bekker:    { id: "aaaaaaaa-0000-0000-0000-000000000002", name: "T Bekker",      no: 2, role: "allrounder" },
  naidoo:    { id: "aaaaaaaa-0000-0000-0000-000000000003", name: "S Naidoo",      no: 3, role: "bowler" },
  seven:     { id: "aaaaaaaa-0000-0000-0000-0000000000a7", name: "V Mate Seven",  no: 67, role: "bowler" },
  six:       { id: "aaaaaaaa-0000-0000-0000-0000000000a6", name: "V Mate Six",    no: 66, role: "batter" },
};
export const IDS = Object.fromEntries(Object.entries(PLAYERS).map(([k, p]) => [k, p.id]));
const NAMES = Object.fromEntries(Object.entries(PLAYERS).map(([k, p]) => [k, p.name]));
const ORDER = ["whitfield", "bekker", "naidoo", "pillay", "seven", "six"];

export const MATCH = { field: "ca000000-0000-0000-0000-000000000001", bat: "ca000000-0000-0000-0000-000000000002",
                       day: "ca000000-0000-0000-0000-000000000003", played: "ca000000-0000-0000-0000-000000000004" };

/** The year, as the school season's label: the fixtures, the honour and the calendar agree on it. */
const year = () => String(new Date().getUTCFullYear());

const rowsOf = (resource, rows) => ({ resource, rows });

/** A ball_event row as the events read returns it. @param {any} ev @param {number} seq */
const eventRow = (ev, seq) => ({ ...toRow(ev), seq, epoch: 1, idempotency_key: ev.id });

/**
 * @param {{ origin: string }} o
 * @returns {(method: string, pathname: string, search: URLSearchParams) => { status: number, body: any }}
 */
export function captainApi() {
  const season = year();
  const logs = captainLogs({ ids: IDS, names: NAMES });
  const fold = { startsAt: null, format: "T20", conditions: PLAY, conditionsHash: "mock", conditionsFixed: true, conditionsSources: SOURCES, conditionsTitle: null, conditionsVersion: null };
  const events = {
    [MATCH.field]: logs.field.map((e, i) => eventRow(e, i + 1)),
    [MATCH.bat]: logs.bat.map((e, i) => eventRow(e, i + 1)),
    [MATCH.played]: logs.bat.map((e, i) => eventRow(e, i + 1)),
    [MATCH.day]: [],
  };
  const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString();
  const match = (id, status, startsAt) => ({
    id, school_id: HIL, team_code: "1XI", opponent: "Westville Boys' High 1XI", starts_at: startsAt, format: "T20", overs: 20, status,
    season, sport: "cricket", away_school_id: WES, away_team_code: "1XI", competition_id: null,
    home_label: "Hilton College 1XI", away_label: "Westville Boys' High 1XI", home_code: "HIL", away_code: "WBH", my_side: "home",
    toss_won_by: null, toss_decision: null, bats_first: null, toss_at: null, ground: "Gordon Sherwood Oval", ground_end_a: null, ground_end_b: null,
  });
  const matches = [
    match(MATCH.day, "scheduled", tomorrow),
    match(MATCH.bat, "live", "2026-10-02T08:00:00.000Z"),
    match(MATCH.field, "live", "2026-10-02T07:00:00.000Z"),
    match(MATCH.played, "complete", "2026-09-26T07:00:00.000Z"),
  ];
  const squad = (id) => ORDER.map((k, i) => ({ match_id: id, player_id: IDS[k], side: "home", batting_no: i + 1, twelfth: false, full_name: NAMES[k] }));
  const career = ORDER.map((k, i) => ({
    player_id: IDS[k], full_name: NAMES[k], team_code: "1XI", school_id: HIL, season, current_season: true, bat_matches: 2 + i, runs: 60 + 10 * i,
    balls_faced: 70 + 8 * i, fours: 6, sixes: 1, dismissals: 2, runs_conceded: i === 2 ? 66 : 0, balls_bowled: i === 2 ? 48 : 0, wickets: i === 2 ? 4 : 0,
  }));
  const session = {
    user: { id: "88888888-0000-0000-0000-000000000009", name: "R Pillay", email: "pillay@example.invalid" }, deviceId: "dev-a11y-captain",
    assignments: [
      { id: "a5510000-0000-0000-0000-00000000000c", role: "player", school: HIL, schoolName: "Hilton College", team: "1XI", season: null, fixture: null, from: null, until: null, expiresAt: null, subjects: [], children: [] },
      { id: "a5510000-0000-0000-0000-00000000000d", role: "selfaccess", school: HIL, schoolName: "Hilton College", team: null, season: null, fixture: null, from: null, until: null, expiresAt: null, subjects: [IDS.pillay], children: [IDS.pillay] },
    ],
  };

  /** @type {Record<string, (q: URLSearchParams) => any[]>} */
  const reads = {
    players: () => ORDER.map((k) => ({ id: IDS[k], school_id: HIL, school_name: "Hilton College", full_name: NAMES[k], team_code: "1XI", squad_no: PLAYERS[k].no,
      playing_role: PLAYERS[k].role, batting_style: "R", bowling_arm: null, bowling_style: k === "naidoo" ? "F" : null, fitness: null })),
    users: () => [{ id: session.user.id, school_id: HIL, email: session.user.email, name: session.user.name, role: "player", active: true, last_seen_at: null, teams: ["1XI"], player_id: IDS.pillay }],
    matches: () => matches,
    honours: () => [{ id: "ca000000-0000-0000-0000-0000000000f1", player_id: IDS.pillay, full_name: NAMES.pillay, school_id: HIL, team_code: "1XI", kind: "captain",
      name: null, label: "Captain", season, citation: null, awarded_on: "2026-08-15", is_public: false, awarded_by_name: null }],
    seasons: () => [{ id: "ca000000-0000-0000-0000-0000000000e1", level: "school", label: season, starts_on: `${season}-01-01`, ends_on: `${season}-12-31`, cutoff_on: `${season}-01-01`, current: true }],
    match_squad: (q) => squad(q.get("matchId")),
    career_by_season: () => career,
    bowling_directives: () => [{ age_band: "open", max_overs_per_spell: null, max_overs_per_day: null, clause_code: null }],
    pitch_report: () => [{ match_id: MATCH.day, surface: "firm", grass: "covered", bounce: "even", pace: "quick", favours: "seam", covers_on: false, notes: null,
      bounce_rating: null, pace_rating: null, outfield: null, reported_at: "2026-10-02T06:00:00.000Z" }],
    league: () => [{ id: "ca000000-0000-0000-0000-0000000000d1", competition_id: "99999999-0000-0000-0000-000000000001", school_id: WES, team_code: "1XI",
      display_name: "Westville Boys' High 1XI", played: 5, won: 3, lost: 2, tied: 0, drawn: 0, no_result: 0, points: 12, net_run_rate: 0.4, basis: "computed", rank: 2 }],
    matchups: (q) => (q.get("batterId") === IDS.pillay ? [{ batter_id: IDS.pillay, batter_name: NAMES.pillay, bowler_id: IDS.naidoo, bowler_name: NAMES.naidoo, bowling_style: "F", balls: 6, runs: 8, dots: 2, fours: 1, sixes: 0, dismissals: 0 }] : []),
    sports: () => [{ code: "cricket", label: "Cricket", engine: "scoring", flag_key: "sport_cricket", enabled: true, fixtures: 4 }],
    my_features: () => [{ key: "analytics", kind: "module", label: "Analytics", enabled: true }, { key: "training", kind: "module", label: "Training", enabled: true },
      { key: "sport_cricket", kind: "sport", label: "Cricket", enabled: true }],
  };

  return (method, pathname, search) => {
    if (pathname === "/api/health") return { status: 200, body: { ok: true, db: "ok", ai: "no_credentials", auth: "dev_login_enabled", read: [], write: "mounted", handover: "mounted", public: "off", pages: "local", reader: "none" } };
    if (pathname === "/api/auth/dev-login") return { status: 200, body: { token: "a11y-captain-token" } };
    if (pathname === "/api/session") return { status: 200, body: session };
    if (pathname === "/api/competition-invitations") return { status: 200, body: { invitations: [] } };
    if (pathname === "/api/lifts/mine") return { status: 200, body: { rows: [] } };
    const read = /^\/api\/read\/([a-z_]+)$/.exec(pathname);
    if (read) return { status: 200, body: rowsOf(read[1], reads[read[1]]?.(search) ?? []) };
    const m = /^\/api\/matches\/([^/]+)\/([a-z-]+)$/.exec(pathname);
    if (m && method === "GET") {
      if (m[2] === "events") return { status: 200, body: { matchId: m[1], events: events[m[1]] ?? [], quarantined: 0, fold: { ...fold, startsAt: matches.find((x) => x.id === m[1])?.starts_at ?? null } } };
      if (m[2] === "result") return { status: 200, body: { result: null } };
      if (m[2] === "lifts") return { status: 403, body: { error: "module_disabled" } };
    }
    return { status: 404, body: { error: "not_found" } };
  };
}
