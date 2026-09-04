/**
 * SCRBRD — Read API (Step 3)
 *
 * The server does NO RBAC here. Every read runs through runAsPrincipal(), so:
 *   - RLS filters rows          (spectator → 0 injuries, coach → own team)
 *   - masked views null columns (analyst → born IS NULL)
 * The handler just picks a query and returns rows. Authorization lives entirely
 * in the database — the point of Steps 1–2.
 *
 * Rule: PII/clinical resources MUST read the *_masked views, never base tables.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

// resource → query. `masked: true` documents (and lets tests assert) that the
// query reads a masking view. `params` maps request query → SQL params.
export const READ_QUERIES = {
  matches: {
    // These column names are the real ones. The query named home_team,
    // away_team, venue, match_date, result and competition_id — six columns
    // that have never existed on this table — so every call returned SQLSTATE
    // 42703 and the fixture list could not load at all. Nothing caught it
    // because the read suite runs against a fake pool that answers any query
    // with canned rows: it proves the handler does no RBAC of its own, and is
    // structurally incapable of noticing that the SQL is wrong.
    //
    // `opponent` is a free-text away side, because a fixture against a school
    // that is not a SCRBRD tenant has no row to point at.
    text: `select m.id, m.school_id, m.team_code, m.opponent, m.starts_at,
                  m.format, m.overs, m.status, m.toss_won_by, m.toss_decision,
                  g.name as ground
             from match m
             left join ground g on g.id = m.ground_id
            order by m.starts_at desc`,
  },
  live_score: {
    text: `select match_id, innings, runs, wickets, legal_balls, last_seq, last_ball_at
             from match_live_score
            where match_id = $1
            order by innings`,
    params: q => [req(q, "matchId")],
  },
  players: {
    masked: true,
    text: `select id, full_name, team_code, playing_role, batting_style, bowling_style,
                  born, hometown, height, weight            -- masked per role
             from player_masked
            order by full_name`,
  },
  injuries: {
    masked: true,
    text: `select id, player_id, injury_type, severity, date_injured, rtw_date,
                  phase, restricted, notes, physio           -- notes/physio masked per role
             from injury_masked
            order by date_injured desc`,
  },
  /**
   * Point-era balls for one match, for the continuous heat map.
   *
   * The placement_source filter is HERE, in the query layer, and not left to
   * report code. A heat map built from sector-era balls would be plotting
   * wedge centroids as if they were positions — and because the two eras will
   * live in the same career view indefinitely, "the report remembers to
   * filter" is not a property anyone can rely on. The excluded count comes
   * back with it so a view can state what it left out rather than quietly
   * dropping a third of an innings.
   */
  shot_points: {
    text: `select b.seq, b.innings, b.ball_type, b.value, b.shot,
                  b.theta, b.radius, b.close_position, b.capture_profile,
                  b.striker_id, b.bowler_id
             from ball_event b
            where b.match_id = $1
              and b.placement_source = 'point'
              and b.capture_profile in ('full','standard')
            order by b.seq`,
    params: q => [req(q, "matchId")],
  },
  shot_point_coverage: {
    text: `select count(*) filter (where placement_source = 'point')  as points,
                  count(*) filter (where placement_source is distinct from 'point'
                                     and seg is not null)              as sector_era,
                  min(server_ts) filter (where placement_source = 'point') as first_point_at
             from ball_event
            where match_id = $1 and kind = 'ball'`,
    params: q => [req(q, "matchId")],
  },

  competitions: {
    text: `select id, name, comp_type, format, age_group, gender, school_id, season
             from competition
            order by name`,
  },

  // ── The programme reads ─────────────────────────────────────────
  // Everything below used to be served from a mock module in the browser,
  // filtered by a client-side copy of authorize(). None of it had a query
  // here because none of it had a table. Each one is a decision that has
  // moved from JavaScript into Postgres.

  // People. Read through the masking views, never the base tables: a coach
  // reads a colleague's name and title, and their date of birth and home
  // address come back NULL unless the reader holds player.pii.read in a scope
  // that covers them. That is evaluated per row, so one query serves a person
  // whose authority differs between two schools.
  coaches: {
    masked: true,
    text: `select id, school_id, team_code, name, title,
                  email, phone, born, hometown, address   -- masked per role
             from coach_masked
            order by name`,
  },
  staff: {
    masked: true,
    text: `select id, school_id, name, duty,
                  email, phone, born, hometown, address   -- masked per role
             from staff_masked
            order by name`,
  },

  // The account directory. This table was one of four sitting with row-level
  // security switched off — a cross-tenant list of every name and email on the
  // platform, minors included, to anyone with a login. The policy that governs
  // it now also lets a person read their own row, which is why the session
  // route works for someone who holds no user.read at all.
  users: {
    text: `select id, school_id, email, name, role, active, last_seen_at, teams
             from app_user
            where active
            order by name`,
  },

  grounds: {
    text: `select id, school_id, name, surface
             from ground
            order by name`,
  },

  // Training splits in two, and the split is the security model rather than a
  // normalisation preference: the SESSION is a noticeboard fact behind
  // team.read, the REGISTER is a list of named minors behind
  // player.profile.read. A parent can learn that training moved to 06:30
  // without being handed every child who was there.
  training: {
    text: `select t.id, t.school_id, t.team_code, t.title, t.starts_at,
                  t.duration_min, t.venue, t.session_type, t.drills, t.notes,
                  t.cancelled, c.name as coach_name
             from training_session t
             left join coach c on c.id = t.coach_id
            order by t.starts_at`,
  },
  training_attendance: {
    text: `select a.session_id, a.player_id, a.status, p.full_name
             from training_attendance a
             join player p on p.id = a.player_id
            where ($1::uuid is null or a.session_id = $1)
            order by p.full_name`,
    // Optional: the whole register this person may see, or one session's.
    params: q => [q?.sessionId || null],
  },

  // Development assessments. Governed by player.development.read, which
  // neither spectator nor guardian holds — a parent reads their child's
  // profile and availability, and a coaching judgement of their technique is
  // not a document the platform hands over on its own.
  skills: {
    text: `select s.player_id, s.assessed_on, s.category, s.metric, s.score,
                  p.full_name, p.team_code
             from player_skill s
             join player p on p.id = s.player_id
            order by s.assessed_on desc, p.full_name`,
  },

  // Notices. The read policy demands news.read AND the capability each row
  // declares for its own subject matter, in the same scope — so this query
  // needs no filter of its own beyond ordering, and MUST NOT grow one that
  // looks like an authorization check. If a row comes back, the database
  // decided this person may have it.
  notifications: {
    text: `select n.id, n.school_id, n.team_code, n.scope_level, n.kind,
                  n.urgency, n.title, n.body, n.subject_kind, n.subject_id,
                  n.published_at, n.is_public, n.subject_person_id,
                  (r.person_id is not null) as read
             from notification n
             left join notification_read r
                    on r.notification_id = n.id and r.person_id = app_user_id()
            where n.expires_at is null or n.expires_at > now()
            order by n.published_at desc`,
  },

  // The league ladder. Readable whole by anyone who can reach the competition,
  // through the organiser or through any entrant — a log with one row in it is
  // not a log. Writing a row stays anchored to the entrant's own school.
  league: {
    text: `select e.competition_id, e.school_id, e.team_code, e.display_name,
                  e.played, e.won, e.lost, e.drawn, e.no_result, e.points,
                  e.net_run_rate
             from competition_entrant e
            where ($1::uuid is null or e.competition_id = $1)
            order by e.points desc, e.net_run_rate desc nulls last, e.display_name`,
    params: q => [q?.competitionId || null],
  },

  // Conditions, scoped through the fixture. Nothing here is personal, but a
  // weather table readable by anyone would quietly answer "does this school
  // have a fixture on Saturday?" to whoever asked.
  weather: {
    text: `select match_id, condition, temp_c, humidity_pct, wind_kph, wind_dir,
                  uv_index, rain_chance_pct, forecast, playable, observed_at
             from match_weather`,
  },

  /**
   * Career figures, derived from the ball log and never stored.
   *
   * The scope is the point, not a caveat. These read ball_event_live, which is
   * security_invoker, so the aggregate covers exactly the deliveries this
   * person may see — and two people will legitimately get different career
   * totals for the same player. That is the architecture's own rule: an
   * aggregate leaks as surely as a row, and a "true" average computed over
   * matches the reader cannot see would disclose that those matches exist and
   * how they went.
   *
   * `matches` comes back so a screen can say what the number was computed
   * over, rather than presenting a partial figure as a career.
   *
   * Averages and strike rates are computed HERE rather than in SQL, so the
   * division-by-zero cases stay visible: a batter who has never been out has
   * no average, which is not the same as an average of zero, and a bowler who
   * has bowled no legal ball has no economy rate.
   */
  career: {
    text: `select p.id                                   as player_id,
                  p.full_name, p.team_code, p.school_id,
                  coalesce(bat.matches, 0)               as bat_matches,
                  coalesce(bat.runs, 0)                  as runs,
                  coalesce(bat.balls_faced, 0)           as balls_faced,
                  coalesce(bat.fours, 0)                 as fours,
                  coalesce(bat.sixes, 0)                 as sixes,
                  coalesce(d.dismissals, 0)              as dismissals,
                  coalesce(bowl.matches, 0)              as bowl_matches,
                  coalesce(bowl.runs_conceded, 0)        as runs_conceded,
                  coalesce(bowl.legal_balls, 0)          as balls_bowled,
                  coalesce(bowl.wickets, 0)              as wickets,
                  coalesce(f.form, '{}')                 as form
             from player p
             left join player_batting_career bat on bat.player_id = p.id
             left join player_dismissals      d   on d.player_id  = p.id
             left join player_bowling_career  bowl on bowl.player_id = p.id
             -- The form guide: the last eight innings, most recent first. A
             -- LATERAL rather than a join, because it is a different grain —
             -- one row per innings — and joining it would multiply the career
             -- totals above by the number of innings played.
             left join lateral (
               select array_agg(x.runs order by x.ended_at desc) as form
                 from (select i.runs, i.ended_at
                         from player_innings i
                        where i.player_id = p.id
                        order by i.ended_at desc
                        limit 8) x
             ) f on true
            order by p.full_name`,
  },

  // The team sheet for a fixture: a roster of identified minors, governed by
  // player.profile.read rather than fixture.read. The difference is a
  // spectator, who should see the score without also receiving a list of
  // children by name and school.
  match_squad: {
    text: `select s.match_id, s.player_id, s.side, s.batting_no, p.full_name
             from match_squad s
             join player p on p.id = s.player_id
            where s.match_id = $1
            order by s.side, s.batting_no nulls last`,
    params: q => [req(q, "matchId")],
  },
};

function req(q, key) {
  const v = q?.[key];
  if (v === undefined || v === null || v === "") { const e = new Error(`missing_param:${key}`); e.status = 400; throw e; }
  return v;
}

/**
 * Read a resource under the caller's principal.
 * @returns rows already row-filtered (RLS) and column-masked (views).
 */
export async function readResource(pool, secret, bearer, resource, query = {}) {
  const def = READ_QUERIES[resource];
  if (!def) { const e = new Error("unknown_resource"); e.status = 404; throw e; }
  const params = def.params ? def.params(query) : [];
  return runAsPrincipal(pool, secret, bearer, async client => {
    const { rows } = await client.query(def.text, params);
    return rows;
  });
}

/** Which resources are wired for live reads (for the client's feature flags / a health check). */
export function liveResources() { return Object.keys(READ_QUERIES); }

// ── Express/Fastify route: GET /read/:resource ──
export function readRoute({ pool, secret }) {
  return async (req, res) => {
    try {
      const rows = await readResource(pool, secret, req.headers?.authorization, req.params.resource, req.query || {});
      res.json({ resource: req.params.resource, rows });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.code || e.message });
    }
  };
}
