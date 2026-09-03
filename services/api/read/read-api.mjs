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
    text: `select id, name, comp_type, format, age_group, gender, school_id
             from competition
            order by name`,
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
