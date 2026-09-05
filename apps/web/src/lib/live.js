/**
 * SCRBRD — reading live rows in place of mock ones.
 *
 * The views were written against the mock constants and read them through the
 * choke point in rbac/ — row-scoped and column-masked for the signed-in
 * principal, which is the right shape but the wrong data once there is a
 * server. This is the bridge: same call site, same shape, real rows.
 *
 * WHY AN ADAPTER AND NOT A RESHAPED API
 * ────────────────────────────────────
 * The API returns the database's column names, and it should — it is the
 * schema's vocabulary, and the read tests assert against it. The views speak
 * the product's vocabulary (`homeTeam`, `venue`, `status: "upcoming"`). One of
 * those has to bend, and it is cheaper and safer for the translation to live
 * in one named function than for either side to compromise.
 *
 * WHAT THIS IS NOT
 * ────────────────
 * Not an authorization layer. The rows arriving here have already been filtered
 * by row-level security and column-masked per capability, in Postgres, for this
 * person. Nothing below re-checks that, and nothing below should be trusted to:
 * if a field is present it is because the database decided this person may see
 * it. The mock fallback IS scoped client-side (through rbac/), because mock
 * rows have no database behind them — that is a demo affordance, not security.
 */
import { useEffect, useState } from "react";
import { api, signedIn } from "./api.js";
import { scoped, scopedSkills, scopedWeather } from "../rbac/index.js";

/** DB fixture status → the vocabulary the views filter on. */
const MATCH_STATUS = { scheduled: "upcoming", live: "live", complete: "complete", abandoned: "complete" };

/**
 * A fixture, in the shape the Match Centre draws.
 *
 * `opponent` is free text because a school SCRBRD does not host has no row to
 * point at, and `team_code` is the home side's scope anchor rather than a
 * display name — so the home team reads as the school's own team code until
 * there is a place to store a display name for it.
 */
function asMatch(r) {
  return {
    id: r.id,
    homeTeam: r.team_code ?? "Home",
    awayTeam: r.opponent,
    venue: r.ground ?? null,
    groundId: null,
    date: r.starts_at ? String(r.starts_at).slice(0, 10) : null,
    status: MATCH_STATUS[r.status] ?? "upcoming",
    result: null,
    competition: null,
    overs: r.overs,
    format: r.format,
    schoolId: r.school_id,
    // The scorecard is DERIVED, never stored — a live score comes from
    // replaying ball_event, not from a column. The Match Centre shows a
    // placeholder until the live-score read is wired to the same view.
    scorecard: null,
    live: true,
  };
}

/**
 * A person, in the shape the squad and profile screens draw.
 *
 * The masked columns arrive as NULL when the reader may not have them, and
 * that is a decision Postgres already made per row. Nothing here re-checks it
 * and nothing here supplies a default in their place: `born: null` means "you
 * may not see this", and turning it into "—" is the view's job, not this
 * function's. A fallback here would quietly convert a refusal into a value.
 */
function asPlayer(r) {
  return {
    id: r.id,
    name: r.full_name,
    team: r.team_code,
    school: r.school_id,
    squadNo: r.squad_no,
    role: r.playing_role,
    batHand: r.batting_style,
    bowlStyle: r.bowling_style,
    fitness: r.fitness,
    born: r.born,
    hometown: r.hometown,
    houseAtSchool: r.houseatschool,
    height: r.height,
    weight: r.weight,
    guardian: r.guardian,
    email: r.email,
    phone: r.phone,
    // The mock carried avg, sr, wkts, econ, cap and an eight-innings form
    // array. NONE of those are columns: they are derived from ball_event by
    // replaying it, which is the whole premise of the schema. They are absent
    // here rather than zeroed, because a batting average of 0 and an unknown
    // batting average are different claims and only one of them is true.
    live: true,
  };
}

function asCoach(r) {
  return { id: r.id, name: r.name, role: r.title, team: r.team_code, school: r.school_id,
           email: r.email, phone: r.phone, born: r.born, hometown: r.hometown,
           address: r.address, live: true };
}

function asStaff(r) {
  return { id: r.id, name: r.name, role: r.duty, school: r.school_id,
           email: r.email, phone: r.phone, born: r.born, hometown: r.hometown,
           address: r.address, live: true };
}

function asUser(r) {
  return { id: r.id, name: r.name, email: r.email, role: r.role, school: r.school_id,
           status: r.active ? "active" : "inactive",
           lastLogin: r.last_seen_at, teams: r.teams, live: true };
}

function asGround(r) {
  return { id: r.id, name: r.name, shortName: r.name, school: r.school_id,
           type: r.surface, available: true, live: true };
}

function asTraining(r) {
  const t = r.starts_at ? new Date(r.starts_at) : null;
  return {
    id: r.id,
    title: r.title,
    team: r.team_code,
    school: r.school_id,
    date: t ? t.toISOString().slice(0, 10) : null,
    time: t ? t.toISOString().slice(11, 16) : null,
    duration: r.duration_min,
    venue: r.venue,
    coach: r.coach_name,
    type: r.session_type,
    drills: r.drills ?? [],
    notes: r.notes,
    cancelled: r.cancelled,
    // The register is a SEPARATE read behind player.profile.read, because it
    // is a list of named minors and this row is a noticeboard fact. Merging
    // them here would undo the split the schema exists to make: a parent could
    // not learn training moved without also receiving every child who was
    // there. Views that need it read `training_attendance`.
    attendance: undefined,
    live: true,
  };
}

function asNotification(r) {
  return {
    id: r.id, type: r.kind, urgency: r.urgency, title: r.title, body: r.body,
    time: r.published_at, read: r.read, team: r.team_code, school: r.school_id,
    isPublic: r.is_public,
    // The mock carried a `roles: [...]` list, and it was never security — it
    // was a filter the browser applied to rows it already held. The server
    // does not send a notice this person may not have, so there is nothing
    // left to filter and no list to carry.
    live: true,
  };
}

function asLadderRow(r) {
  return { id: `${r.competition_id}:${r.school_id}:${r.team_code ?? ""}`,
           name: r.display_name, school: r.school_id, team: r.team_code,
           played: r.played, wins: r.won, losses: r.lost, draws: r.drawn,
           noResult: r.no_result, points: r.points, nrr: r.net_run_rate, live: true };
}

function asCompetition(r) {
  return { id: r.id, name: r.name, type: r.comp_type, format: r.format,
           ageGroup: r.age_group, gender: r.gender, season: r.season,
           school: r.school_id, active: true,
           // The ladder is its own read (`league`), scoped by participation
           // rather than by who created the competition row.
           table: undefined, live: true };
}

function asWeather(r) {
  return { matchId: r.match_id, condition: r.condition, tempC: r.temp_c,
           humidity: r.humidity_pct, windKph: r.wind_kph, windDir: r.wind_dir,
           uvIndex: r.uv_index, rainChancePct: r.rain_chance_pct,
           forecast: r.forecast, playable: r.playable, live: true };
}

function asInjury(r) {
  return { id: r.id, player: r.player_id, type: r.injury_type, severity: r.severity,
           dateInj: r.date_injured, rtw: r.rtw_date, phase: r.phase,
           restricted: r.restricted, notes: r.notes, physio: r.physio, live: true };
}

/**
 * A career line, with the derived figures the squad screens draw.
 *
 * Averages and rates are computed here, from the counts the database returned,
 * so the undefined cases stay undefined. A batter who has never been out has
 * NO average — not an average equal to their run total, and certainly not
 * zero — and a player who has not batted has no strike rate. Sending null
 * rather than a number means a view renders "—" instead of stating something
 * false with two decimal places on it.
 *
 * `matches` rides along because these figures are scoped: they cover the
 * deliveries this reader may see, and a screen that shows a career average
 * should be able to say what it was computed over.
 */
function asCareer(r) {
  const runs = Number(r.runs), balls = Number(r.balls_faced);
  const outs = Number(r.dismissals);
  const conceded = Number(r.runs_conceded), bowled = Number(r.balls_bowled);
  const wkts = Number(r.wickets);
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    id: r.player_id,
    name: r.full_name,
    team: r.team_code,
    school: r.school_id,
    innings: Number(r.bat_matches),
    runs, ballsFaced: balls, fours: Number(r.fours), sixes: Number(r.sixes),
    dismissals: outs,
    avg: outs > 0 ? round2(runs / outs) : null,
    sr: balls > 0 ? round2((runs * 100) / balls) : null,
    wkts,
    ballsBowled: bowled, runsConceded: conceded,
    econ: bowled > 0 ? round2((conceded * 6) / bowled) : null,
    // Most recent innings first, at most eight. Always an array — a player
    // who has not batted has an empty form guide, which a view can render as
    // such; undefined would crash the .map() that draws it.
    form: Array.isArray(r.form) ? r.form.map(Number) : [],
    bowlAvg: wkts > 0 ? round2(conceded / wkts) : null,
    live: true,
  };
}

function asSkill(r) {
  return { playerId: r.player_id, name: r.full_name, team: r.team_code,
           assessedOn: r.assessed_on, category: r.category, metric: r.metric,
           score: r.score, live: true };
}

function asAttendance(r) {
  return { sessionId: r.session_id, playerId: r.player_id, name: r.full_name,
           status: r.status, live: true };
}

/**
 * resource → row adapter. A resource with no entry here is not wired for live
 * reads, and useLive() says so rather than guessing: an adapter that passed
 * unknown rows through unchanged would put raw column names in front of a view
 * expecting the product's vocabulary, and the failure would look like missing
 * data rather than a missing adapter.
 */
const ADAPT = {
  matches: asMatch,
  players: asPlayer,
  coaches: asCoach,
  profiles: asCoach,
  staff: asStaff,
  users: asUser,
  grounds: asGround,
  training: asTraining,
  training_attendance: asAttendance,
  notifications: asNotification,
  league: asLadderRow,
  competitions: asCompetition,
  weather: asWeather,
  injuries: asInjury,
  skills: asSkill,
  career: asCareer,
  ratings: asRating,
  notes: asNote,
};

/**
 * A rating, already composed by the server.
 *
 * The arithmetic is NOT repeated here. The shrinkage, the anchor tables and the
 * sample floors live in packages/scoring/src/rating.mjs and are applied once,
 * in the read API, so every reader of a rating sees the same number. This
 * adapter only renames fields into the shape the screens read.
 *
 * The COACH'S OWN NUMBER and the DRIFT are carried through deliberately. A
 * screen that shows only the adjusted figure cannot answer the question a coach
 * asks first, which is what moved it.
 */
function asRating(r) {
  const side = (d) => ({
    value: d.value, coach: d.coach, performance: d.performance,
    drift: d.drift, basis: d.basis, sample: d.sample,
    weight: d.performanceWeight, attributes: d.attributes,
    anchoredOn: d.anchoredOn ? String(d.anchoredOn).slice(0, 10) : null,
    explanation: d.explanation,
    confidence: d.index?.confidence ?? "none",
    why: d.index?.reason ?? null,
  });
  return {
    id: r.player_id, name: r.full_name, team: r.team_code, school: r.school_id,
    batting: side(r.batting), bowling: side(r.bowling),
  };
}

/**
 * A development note.
 *
 * The author's NAME is carried, not just their id: a candid sentence about a
 * child is weighed by who wrote it, and a screen showing prose over a uuid
 * gives a reader no way to do that.
 */
function asNote(r) {
  return {
    id: r.id, playerId: r.player_id, body: r.body,
    discipline: r.about_discipline, adjustment: r.adjustment,
    observedOn: r.observed_on ? String(r.observed_on).slice(0, 10) : null,
    author: r.author_name || null, authorId: r.author_id,
    revised: !!r.updated_at,
  };
}

/** Resources the client knows how to read live. Used by the wiring tests. */
export function liveResources() { return Object.keys(ADAPT); }

/**
 * Rows for a resource, from the server when there is one.
 *
 * `nonce` is how a screen re-reads after it has WRITTEN something. Bumping it
 * re-runs the fetch. Without it a coach saves an assessment and the numbers on
 * the screen stay where they were until a reload — which reads exactly like the
 * save having failed, and is how somebody comes to save the same thing twice.
 *
 * THE RULE THIS ENFORCES
 * ──────────────────────
 * When signed in, the mock is never rendered. Not as a fallback, not while
 * loading, not when the request fails. `scoped()` — which filters mock rows
 * through a client-side copy of authorize() — is called ONLY when there is no
 * session, and in that state the app is a demo and says so.
 *
 * That is the whole point of this function. A signed-in session that quietly
 * fell back to client-scoped mock rows on a flaky connection would be showing
 * a person data that no server ever agreed to give them, in a UI that looks
 * identical to the real thing. An empty list with an error beside it is a
 * worse screen and a true one.
 *
 * Returns { rows, live, loading, error } so a view can tell the three states
 * apart. `loading` matters: an empty array during the first fetch is not the
 * same statement as an empty array after it, and "no fixtures today" is a
 * claim the UI should only make once the server has actually said so.
 */
export function useLive(resource, role, nonce = 0) {
  const demo = !signedIn();
  const [state, setState] = useState(() =>
    demo
      ? { rows: scoped(resource, role), live: false, loading: false, error: null }
      : { rows: [], live: false, loading: true, error: null });

  useEffect(() => {
    if (!signedIn()) {
      setState({ rows: scoped(resource, role), live: false, loading: false, error: null });
      return;
    }
    if (!ADAPT[resource]) {
      setState({ rows: [], live: false, loading: false, error: "no_adapter" });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const { rows } = await api(`/api/read/${resource}`);
        if (!cancelled) setState({ rows: rows.map(ADAPT[resource]), live: true, loading: false, error: null });
      } catch (e) {
        // Deliberately NOT falling back to mock. See above.
        if (!cancelled) setState({ rows: [], live: false, loading: false, error: e.code || "unreachable" });
      }
    })();
    return () => { cancelled = true; };
  }, [resource, role, nonce]);

  return state;
}

/**
 * Skills, in the nested shape the development screens draw:
 *   { [playerId]: { technical: { footwork: 14, … }, mental: { … }, physical: { … } } }
 *
 * Groups and attributes are the rubric's (packages/scoring/src/rubric.mjs) and
 * scores are 1-20; this function only pivots, and asserts nothing about either.
 *
 * The table is long-form — one row per player per metric per assessment date —
 * because a blob cannot be masked, cannot be indexed by metric, and cannot
 * record WHEN a judgement was made, and the point of a development record is
 * the trend. The pivot happens here so the views keep the shape they were
 * written against, and only the most recent assessment of each metric wins.
 */
export function useSkills(role, nonce = 0) {
  const { rows, live, loading, error } = useLive("skills", role, nonce);
  const demo = !signedIn();
  if (demo) return scopedSkills(role);
  const out = {};
  const seen = new Set();
  // Rows arrive newest first (assessed_on desc), so the first one wins.
  for (const r of rows) {
    const key = `${r.playerId}:${r.category}:${r.metric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (out[r.playerId] ??= {})[r.category] ??= {};
    out[r.playerId][r.category][r.metric] = r.score;
  }
  void live; void loading; void error;
  return out;
}

/** Weather, keyed by match id — the shape the fixture screens index into. */
export function useWeather(role) {
  const { rows } = useLive("weather", role);
  if (!signedIn()) return scopedWeather(role);
  return Object.fromEntries(rows.map((w) => [w.matchId, w]));
}

/**
 * Players with their career figures merged in.
 *
 * The squad screens were written against mock rows carrying avg, sr, wkts,
 * econ and an eight-innings form array. None of those are columns — they are
 * derived from the ball log — so after the read path went live those screens
 * rendered blanks. This joins the two reads so the call site stays one line.
 *
 * A player with no career row keeps null figures rather than zeros: nobody has
 * scored 0 at an average of 0. They have not batted.
 */
export function usePlayersWithCareer(role) {
  const players = useRows("players", role);
  const career = useRows("career", role);
  if (!career.length) return players;
  const byId = new Map(career.map((c) => [c.id, c]));
  return players.map((p) => {
    const c = byId.get(p.id);
    return c ? { ...p, ...c, name: p.name ?? c.name } : p;
  });
}

/** The common case: just the rows. Views that need the state use useLive(). */
/**
 * Ratings, keyed by player id so a screen can look one up beside a squad row.
 *
 * There is no mock fallback and no demo derivation: a rating is a coach's
 * judgement about a named child combined with that child's match record, and
 * inventing either half for a signed-out demo would put a fabricated number
 * next to a real name. Signed out, this is empty and the screens say so.
 */
export function useRatings(role, nonce = 0) {
  const { rows, live, loading, error } = useLive("ratings", role, nonce);
  const byPlayer = {};
  for (const r of rows) byPlayer[r.id] = r;
  return { ratings: byPlayer, live, loading, error };
}

/**
 * Notes for one player, newest first.
 *
 * No mock fallback: a development note is a named coach's writing about a named
 * child, and a fabricated one on a demo screen would read exactly like a real
 * one. Signed out this is empty.
 */
export function useNotes(role, playerId, nonce = 0) {
  const { rows, live, loading, error } = useLive("notes", role, nonce);
  return { notes: rows.filter((n) => !playerId || n.playerId === playerId), live, loading, error };
}

export function useRows(resource, role) { return useLive(resource, role).rows; }

/**
 * Live rows for a resource, falling back to what was passed in.
 *
 * Kept for the Match Centre, which passes its own fallback. New call sites
 * should use useLive(), which owns the demo/live decision instead of taking a
 * pre-computed fallback that has already run the client-side filter.
 *
 * Returns `mockRows` immediately so the page paints without waiting, then
 * swaps once the server answers. On failure it keeps the fallback and reports
 * it: a fixture list that silently empties on a flaky connection looks like
 * "no matches today", which is a different and much worse statement.
 */
export function useLiveRows(resource, mockRows) {
  const [state, setState] = useState({ rows: mockRows, live: false, error: null });

  useEffect(() => {
    if (!signedIn() || !ADAPT[resource]) return;
    let cancelled = false;
    (async () => {
      try {
        const { rows } = await api(`/api/read/${resource}`);
        if (!cancelled) setState({ rows: rows.map(ADAPT[resource]), live: true, error: null });
      } catch (e) {
        if (!cancelled) setState({ rows: mockRows, live: false, error: e.code || "unreachable" });
      }
    })();
    return () => { cancelled = true; };
    // mockRows is rebuilt on every render by the scoped() call above the hook;
    // depending on it would refetch forever.
  }, [resource]);

  return state;
}
