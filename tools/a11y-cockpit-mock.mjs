/**
 * An API for smoke-a11y to point a signed-in COACH at (SCRBRD-136/137 phase A).
 *
 * smoke-a11y runs against the built bundle with no server and no database. The
 * cockpit exists only for a signed-in person whose assignment grants it, so the
 * walk would never see it. This serves, from memory and over Playwright's
 * `page.route`, the routes the coach's Dashboard, Match Centre and Coach tab
 * read: his session (a coach of the 1XI), two fixtures (tonight's, with a sheet
 * of ten, a four-seat bus, an answer, a restriction, a lift and a notice; and
 * a live one under a four-over cap), and the live log of tools/fixture-captain.mjs.
 * Every other read answers with no rows.
 *
 * It is NOT an authorization layer and proves nothing about who may read what:
 * that is tools/smoke-browser-cockpit.mjs's, against the real stack. All it has
 * to do is put the screens on a page so the accessibility ratchets can count
 * what is drawn. Every name is the seed's invented one.
 */
import { toRow } from "@scrbrd/scoring";
import { captainLogs, PLAY, SOURCES } from "./fixture-captain.mjs";

const HIL = "11111111-1111-1111-1111-111111111111";
const PLAYERS = {
  pillay:    { id: "aaaaaaaa-0000-0000-0000-000000000005", name: "R Pillay",        no: 5 },
  whitfield: { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "James Whitfield", no: 1 },
  bekker:    { id: "aaaaaaaa-0000-0000-0000-000000000002", name: "T Bekker",        no: 2 },
  naidoo:    { id: "aaaaaaaa-0000-0000-0000-000000000003", name: "S Naidoo",        no: 3 },
  seven:     { id: "aaaaaaaa-0000-0000-0000-0000000000a7", name: "V Mate Seven",    no: 67 },
  six:       { id: "aaaaaaaa-0000-0000-0000-0000000000a6", name: "V Mate Six",      no: 66 },
  eight:     { id: "aaaaaaaa-0000-0000-0000-0000000000a8", name: "V Mate Eight",    no: 68 },
  nine:      { id: "aaaaaaaa-0000-0000-0000-0000000000a9", name: "V Mate Nine",     no: 69 },
  ten:       { id: "aaaaaaaa-0000-0000-0000-0000000000aa", name: "V Mate Ten",      no: 70 },
  eleven:    { id: "aaaaaaaa-0000-0000-0000-0000000000ab", name: "V Mate Eleven",   no: 71 },
};
export const IDS = Object.fromEntries(Object.entries(PLAYERS).map(([k, p]) => [k, p.id]));
const NAMES = Object.fromEntries(Object.entries(PLAYERS).map(([k, p]) => [k, p.name]));
const ORDER = ["whitfield", "bekker", "naidoo", "pillay", "seven", "six", "eight", "nine", "ten", "eleven"];

export const MATCH = { day: "cc000000-0000-0000-0000-000000000001", live: "cc000000-0000-0000-0000-000000000002" };

/** A ball_event row as the events read returns it. @param {any} ev @param {number} seq */
const eventRow = (ev, seq) => ({ ...toRow(ev), seq, epoch: 1, idempotency_key: ev.id });

/** @returns {(method: string, pathname: string, search: URLSearchParams) => { status: number, body: any }} */
export function cockpitApi() {
  const logs = captainLogs({ ids: IDS, names: NAMES });
  const fold = { startsAt: null, format: "T20", conditions: PLAY, conditionsHash: "mock", conditionsFixed: true, conditionsSources: SOURCES, conditionsTitle: null, conditionsVersion: null };
  // Tonight at 23:00 SA time, whenever the walk runs (the walk's own clock): soon, and the match day.
  const sa = new Date(Date.now() + 2 * 3600e3);
  const tonight = new Date(Date.UTC(sa.getUTCFullYear(), sa.getUTCMonth(), sa.getUTCDate(), 21, 0, 0)).toISOString();
  const match = (id, status, startsAt) => ({
    id, school_id: HIL, team_code: "1XI", opponent: "Verify Cockpit XI", starts_at: startsAt, format: "T20", overs: 20, status,
    season: String(sa.getUTCFullYear()), sport: "cricket", away_school_id: null, away_team_code: null, competition_id: null,
    home_label: "Hilton College 1XI", away_label: null, home_code: "HIL", away_code: null, my_side: "home",
    toss_won_by: null, toss_decision: null, bats_first: null, toss_at: null, ground: "Gordon Sherwood Oval", ground_end_a: null, ground_end_b: null,
  });
  const matches = [match(MATCH.day, "scheduled", tonight), match(MATCH.live, "live", new Date(Date.now() - 3 * 3600e3).toISOString())];
  const squad = (id) => ORDER.map((k, i) => ({ match_id: id, player_id: IDS[k], side: "home", batting_no: i + 1, twelfth: false, full_name: NAMES[k] }));
  const readiness = ORDER.map((k, i) => ({
    player_id: IDS[k], full_name: NAMES[k], team_code: "1XI",
    declared_status: k === "whitfield" ? "unavailable" : k === "seven" || k === "six" ? "available" : null, said_status: null, needs_reconfirming: false,
    reason_kind: null, self_declared: false, declared_by_name: k === "whitfield" ? "Mrs Whitfield" : null,
    clinically_restricted: k === "bekker" || k === "pillay", rtw_date: k === "bekker" ? "2026-10-11T00:00:00.000Z" : k === "pillay" ? "2026-10-18T00:00:00.000Z" : null,
    selected: true, selected_side: "home", batting_no: i + 1,
    state: k === "bekker" || k === "pillay" ? "restricted" : k === "whitfield" ? "unavailable" : k === "seven" || k === "six" ? "available" : "unanswered", conflict: null,
  }));
  const workload = ["whitfield", "bekker", "naidoo", "seven"].map((k) => ({
    player_id: IDS[k], full_name: NAMES[k], team_code: "1XI", school_id: HIL, age_band: "U15", pace: true, max_overs_per_spell: 6, max_overs_per_day: 12,
    overs_7d: k === "bekker" ? 5 : 3, overs_28d: 5, longest_spell_7d: 3, breaches_28d: 0, last_bowled_on: null, sessions_7d: 0, minutes_7d: 0, sessions_28d: 0, minutes_28d: 0,
    acwr: null, load_state: "spike", units_7d: 30, units_28d: 30, estimated_7d: k === "seven", ewma_ratio: "3.6", load_word: k === "naidoo" ? "steady" : "spike", monitored: false,
    clause_code: "PACE-U14-U15", clause_title: "Pace bowling limits", clause_severity: "Mandatory", clause_body: "x",
  }));
  const session = {
    user: { id: "88888888-0000-0000-0000-000000000004", name: "C Hendricks", email: "coach@example.invalid" }, deviceId: "dev-a11y-cockpit",
    assignments: [{ id: "a5510000-0000-0000-0000-000000000004", role: "coach", school: HIL, schoolName: "Hilton College", team: "1XI", season: null, fixture: null, from: null, until: null, expiresAt: null, subjects: [], children: [] }],
  };
  const events = { [MATCH.live]: logs.field.map((e, i) => eventRow(e, i + 1)), [MATCH.day]: [] };

  /** @type {Record<string, (q: URLSearchParams) => any[]>} */
  const reads = {
    matches: () => matches,
    match_squad: (q) => squad(q.get("matchId")),
    // The roster Pick the side offers: the ten on the sheet and a reserve who is not.
    players: () => [...ORDER.map((k) => ({ id: IDS[k], school_id: HIL, school_name: "Hilton College", full_name: NAMES[k], team_code: "1XI", squad_no: PLAYERS[k].no, playing_role: "batter" })),
      { id: "aaaaaaaa-0000-0000-0000-0000000000ac", school_id: HIL, school_name: "Hilton College", full_name: "V Mate Twelve", team_code: "1XI", squad_no: 72, playing_role: "bowler" }],
    readiness: () => readiness,
    workload: () => workload,
    bowling_spells: (q) => (q.get("matchId") === MATCH.live ? [{ match_id: MATCH.live, innings: 0, bowler_id: IDS.bekker, full_name: NAMES.bekker, spell_no: 5, first_over: 13, last_over: 13, overs: 1,
      legal_balls: 6, bowled_on: "2026-10-02", age_band: "U15", pace: true, max_overs_per_spell: 6, max_overs_per_day: 12, over_spell_limit: false, breach_recorded: false }] : []),
    phases: (q) => (q.get("matchId") === MATCH.live ? [{ innings: 0, phases: {
      powerplay: { name: "powerplay", label: "Powerplay", overs: "1–6", played: true, runs: 12, wickets: 0, balls: 36, runRate: 2 },
      middle: { name: "middle", label: "Middle", overs: "7–15", played: true, runs: 14, wickets: 0, balls: 48, runRate: 1.75 },
      death: { name: "death", label: "Death", overs: "16–20", played: true, runs: 0, wickets: 0, balls: 0, runRate: null } } }] : []),
    trips: () => [{ id: "cc000000-0000-0000-0000-0000000000b1", match_id: MATCH.day, school_id: HIL, vehicle_id: "x", registration: "KZN 4 SEAT", vehicle_description: "Verify four-seater",
      capacity: 4, kind: "van", driver_id: null, driver_name: null, depart_at: new Date(Date.parse(tonight) - 2 * 3600e3).toISOString(), return_at: null, pickup: "the Chapel car park", seats_taken: 0,
      notes: null, departed_at: null, arrived_at: null, cancelled_at: null, arranged_at: null, state: "scheduled" }],
    match_duties: () => [], officials: () => [],
    weather: () => [{ match_id: MATCH.day, condition: "Showers", temp_c: 18, humidity_pct: 70, wind_kph: 10, wind_dir: "SW", uv_index: 4, rain_chance_pct: 70, forecast: "Rain likely from 14:00", playable: true, observed_at: new Date().toISOString() }],
    pitch_report: (q) => (q.get("matchId") === MATCH.day ? [{ match_id: MATCH.day, surface: "firm", grass: "covered", bounce: "even", pace: "quick", favours: "seam", covers_on: false, notes: null,
      bounce_rating: null, pace_rating: null, outfield: null, reported_at: new Date().toISOString() }] : []),
    notifications: () => [{ id: "cc000000-0000-0000-0000-0000000000c1", school_id: HIL, team_code: "1XI", scope_level: "team", kind: "notice", urgency: "low", title: "The sheet has changed",
      body: "The sheet for tonight was changed by the selector.", subject_kind: "match", subject_id: MATCH.day, published_at: new Date().toISOString(), is_public: false, subject_person_id: null, read: false }],
    bowling_directives: () => [{ age_band: "open", max_overs_per_spell: 6, max_overs_per_day: 12, clause_code: "PACE-OPEN" }],
    opposition_context: () => [],
    sports: () => [{ code: "cricket", label: "Cricket", engine: "scoring", flag_key: "sport_cricket", enabled: true, fixtures: 2 }],
    my_features: () => [{ key: "analytics", kind: "module", label: "Analytics", enabled: true }, { key: "training", kind: "module", label: "Training", enabled: true },
      { key: "sport_cricket", kind: "sport", label: "Cricket", enabled: true }],
  };
  const doc = { v: 1, play: { "format.kind": "limited", "format.free_hit": true, "format.overs_per_innings": 20 }, sheet: {}, table: {} };

  return (method, pathname, search) => {
    if (pathname === "/api/health") return { status: 200, body: { ok: true, db: "ok", ai: "no_credentials", auth: "dev_login_enabled", read: [], write: "mounted", handover: "mounted", public: "off", pages: "local", reader: "none" } };
    if (pathname === "/api/auth/dev-login") return { status: 200, body: { token: "a11y-cockpit-token" } };
    if (pathname === "/api/session") return { status: 200, body: session };
    if (pathname === "/api/competition-invitations") return { status: 200, body: { invitations: [] } };
    const read = /^\/api\/read\/([a-z_]+)$/.exec(pathname);
    if (read) return { status: 200, body: { resource: read[1], rows: reads[read[1]]?.(search) ?? [] } };
    const m = /^\/api\/matches\/([^/]+)\/([a-z-]+)(?:\/([a-z]+))?$/.exec(pathname);
    if (m && method === "GET") {
      if (m[2] === "events") return { status: 200, body: { matchId: m[1], events: events[m[1]] ?? [], quarantined: 0, fold: { ...fold, startsAt: matches.find((x) => x.id === m[1])?.starts_at ?? null } } };
      if (m[2] === "result") return { status: 200, body: { result: null } };
      if (m[2] === "playing-conditions") return { status: 200, body: { matchId: m[1], doc, sources: {}, docHash: "x", fixed: false, applies: true, setId: null, setVersion: null, setTitle: null, overrides: [] } };
      if (m[2] === "lifts" && m[3] === "expected") return { status: 200, body: { rows: [{ seatId: "s1", offerId: "o1", playerId: IDS.bekker, name: NAMES.bekker, driverName: "H Whitfield", meetAt: new Date(Date.now() - 3 * 3600e3).toISOString(),
        departedAt: null, arrivedAt: null, boardedAt: null, handedOverAt: null, handoverKind: null, acknowledgedAt: null, resolvedAt: null, status: "confirmed", notLeft: true }] } };
      if (m[2] === "venue-par" || m[2] === "dls") return { status: 404, body: { error: "not_found" } };
    }
    return { status: 404, body: { error: "not_found" } };
  };
}
