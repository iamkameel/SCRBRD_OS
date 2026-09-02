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
    text: `select id, home_team, away_team, venue, match_date, status, result,
                  competition_id, school_id
             from match
            order by match_date desc`,
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
export async function readResource(pool, authData, secret, bearer, resource, query = {}) {
  const def = READ_QUERIES[resource];
  if (!def) { const e = new Error("unknown_resource"); e.status = 404; throw e; }
  const params = def.params ? def.params(query) : [];
  return runAsPrincipal(pool, authData, secret, bearer, async client => {
    const { rows } = await client.query(def.text, params);
    return rows;
  });
}

/** Which resources are wired for live reads (for the client's feature flags / a health check). */
export function liveResources() { return Object.keys(READ_QUERIES); }

// ── Express/Fastify route: GET /read/:resource ──
export function readRoute({ pool, authData, secret }) {
  return async (req, res) => {
    try {
      const rows = await readResource(pool, authData, secret, req.headers?.authorization, req.params.resource, req.query || {});
      res.json({ resource: req.params.resource, rows });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.code || e.message });
    }
  };
}
