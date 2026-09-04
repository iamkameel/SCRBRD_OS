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
import {
  DISCIPLINES, battingIndex, bowlingIndex, coachIndex, adjustedRating,
} from "@scrbrd/scoring";

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
    // The roster read. Every coach at the school sees every child in outline;
    // what they see OF each one is decided per column, per row, by the masking
    // view — a coach unmasks their own squad and reads a name, a side and an
    // age for everybody else.
    //
    // address, guardian and id_number are selected DELIBERATELY. They were
    // omitted, which meant an assertion that "a coach cannot read a home
    // address" passed because the query never asked for one — the column list
    // was doing the work and the mask was never exercised. A column list is
    // not an access control: it is the same for everyone and cannot tell a
    // school administrator from a coach. Asking and getting NULL is the mask
    // being tested.
    text: `select id, school_id, full_name, team_code, playing_role,
                  batting_style, bowling_style, fitness,
                  born, hometown, height, weight,           -- masked per role
                  address, guardian, id_number              -- masked per role
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

  /**
   * The rating: what the coach said, what the log says, and the gap.
   *
   * TWO PARAMETERS, AND THEY COME FROM THE RUBRIC. $1 and $2 are the attribute
   * lists the batting and bowling disciplines draw on, passed in from
   * DISCIPLINES rather than written here. A copy of that mapping in SQL is a
   * copy that goes stale the first time an attribute is renamed, and the
   * symptom would be a coach index quietly averaging fewer attributes than it
   * claims to.
   *
   * THE ANCHOR DATE IS PER DISCIPLINE, not per player. A coach who re-rates
   * someone's bowling in September has not re-rated their batting, and treating
   * the later date as the anchor for both would throw away every ball faced
   * since the batting assessment actually happened.
   *
   * `distinct on (category, metric) … order by assessed_on desc` takes the
   * LATEST score for each attribute, so an assessment that only covered four
   * attributes revises those four and leaves the rest standing.
   *
   * A NULL anchor — nobody has assessed this discipline — makes the window
   * NULL, which player_batting_since() reads as no window at all. That is the
   * right answer rather than a special case: with no judgement to anchor on,
   * the rating is the performance index over everything on record.
   */
  ratings: {
    text: `select p.id as player_id, p.full_name, p.team_code, p.school_id,
                  bat_a.anchor        as batting_anchor,
                  bat_a.scores        as batting_scores,
                  coalesce(bs.runs, 0)         as runs,
                  coalesce(bs.balls_faced, 0)  as balls_faced,
                  coalesce(bd.dismissals, 0)   as dismissals,
                  bowl_a.anchor       as bowling_anchor,
                  bowl_a.scores       as bowling_scores,
                  coalesce(ws.runs_conceded, 0) as runs_conceded,
                  coalesce(ws.legal_balls, 0)   as balls_bowled,
                  coalesce(ws.wickets, 0)       as wickets
             from player p
             left join lateral (
               select max(x.assessed_on) as anchor,
                      jsonb_object_agg(x.category || '.' || x.metric, x.score) as scores
                 from (select distinct on (s.category, s.metric)
                              s.category, s.metric, s.score, s.assessed_on
                         from player_skill s
                        where s.player_id = p.id
                          and (s.category || '.' || s.metric) = any($1::text[])
                        order by s.category, s.metric, s.assessed_on desc) x
             ) bat_a on true
             left join lateral (
               select max(x.assessed_on) as anchor,
                      jsonb_object_agg(x.category || '.' || x.metric, x.score) as scores
                 from (select distinct on (s.category, s.metric)
                              s.category, s.metric, s.score, s.assessed_on
                         from player_skill s
                        where s.player_id = p.id
                          and (s.category || '.' || s.metric) = any($2::text[])
                        order by s.category, s.metric, s.assessed_on desc) x
             ) bowl_a on true
             -- Evidence since the coach last looked. A date cast to timestamptz
             -- is midnight, so a match on the afternoon of the assessment day
             -- counts towards it — which is the right way round: the coach
             -- rated him in the nets that morning.
             left join lateral player_batting_since(p.id, bat_a.anchor::timestamptz) bs on true
             left join lateral (select player_dismissals_since(p.id, bat_a.anchor::timestamptz)
                                  as dismissals) bd on true
             left join lateral player_bowling_since(p.id, bowl_a.anchor::timestamptz) ws on true
            order by p.full_name`,
    params: () => [DISCIPLINES.batting, DISCIPLINES.bowling],
    compose: composeRatings,
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

  /**
   * Who is about to age out of their side, and which side to trial them for.
   *
   * DERIVED, not delivered. There is no job publishing these and no row
   * recording that anyone was told — it is arithmetic on a date that has been
   * in the player row since the child was registered, and it is correct the
   * moment it is asked.
   *
   * That is the same discipline as the live score and the career figures: a
   * fact that can be derived is never materialised alongside the thing it is
   * derived from, because the two then drift and nothing says which is right.
   *
   * An injury alert IS a notification, and stays one: an injury happens at a
   * moment, and no amount of looking at the world afterwards tells you it was
   * recorded on Tuesday. A birthday is not an event.
   *
   * Scoped by the same policy as everything else — the view is
   * security_invoker, so a coach sees the children on their own school's
   * roster and none anywhere else.
   */
  band_changes: {
    text: `select player_id, school_id, full_name, current_team, current_band,
                  next_band, next_birthday, turning, days_until, trial_for
             from player_band_change_due
            order by next_birthday`,
  },

  /**
   * Who read what about a child.
   *
   * The answer to a parent asking, and to the Information Regulator. Governed
   * by audit.read at the school, and deliberately NOT readable by the person
   * who generated the entries — a log the reader can read tells them exactly
   * what to avoid next time.
   */
  access_log: {
    text: `select l.id, l.school_id, l.person_id, u.name as person_name,
                  l.resource, l.record_ids, l.record_count, l.fields,
                  l.device_id, l.occurred_at
             from access_log l
             left join app_user u on u.id = l.person_id
            where ($1::uuid is null or l.record_ids @> array[$1::uuid])
            order by l.occurred_at desc
            limit 500`,
    // Optional: everything read about ONE child, which is the question a
    // parent actually asks.
    params: q => [q?.playerId || null],
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

/**
 * Turn one ratings row into two ratings, and their working.
 *
 * COMPOSED HERE RATHER THAN IN SQL, deliberately. The shrinkage, the anchor
 * tables and the sample floors are one implementation in
 * packages/scoring/src/rating.mjs, tested there and shared with anything else
 * that ever needs them. A second copy in SQL would be a second answer to "what
 * is this boy's rating", and the two would disagree the first time either was
 * tuned — which is the bug this codebase has already shipped once, over a
 * voided ball, in two folds of the same log.
 *
 * SQL supplies facts; this supplies judgement about them.
 *
 * `sample` is the deliveries BEHIND the index, and it is the same window the
 * index was computed over — balls faced since the batting anchor, balls bowled
 * since the bowling one. Passing lifetime balls against a windowed index would
 * overstate the confidence in evidence that is not there.
 */
function composeRatings(rows) {
  return rows.map((r) => {
    const batPerf = battingIndex({
      runs: Number(r.runs), ballsFaced: Number(r.balls_faced), dismissals: Number(r.dismissals),
    });
    const bowlPerf = bowlingIndex({
      runsConceded: Number(r.runs_conceded), ballsBowled: Number(r.balls_bowled),
      wickets: Number(r.wickets),
    });
    const batCoach = coachIndex(r.batting_scores ?? {});
    const bowlCoach = coachIndex(r.bowling_scores ?? {});
    return {
      player_id: r.player_id, full_name: r.full_name,
      team_code: r.team_code, school_id: r.school_id,
      batting: {
        anchoredOn: r.batting_anchor, attributes: batCoach.metrics,
        ...adjustedRating({ coach: batCoach.value, performance: batPerf.value,
                            sample: Number(r.balls_faced) }),
        index: batPerf,
      },
      bowling: {
        anchoredOn: r.bowling_anchor, attributes: bowlCoach.metrics,
        ...adjustedRating({ coach: bowlCoach.value, performance: bowlPerf.value,
                            sample: Number(r.balls_bowled) }),
        index: bowlPerf,
      },
    };
  });
}

function req(q, key) {
  const v = q?.[key];
  if (v === undefined || v === null || v === "") { const e = new Error(`missing_param:${key}`); e.status = 400; throw e; }
  return v;
}

/**
 * Read a resource under the caller's principal.
 * @returns rows already row-filtered (RLS) and column-masked (views).
 */
/**
 * The columns whose disclosure is worth a log entry, per resource.
 *
 * POPIA's "personal information", and for injuries "special personal
 * information" under s. 26(b). A read that returns none of these is somebody
 * opening a screen; a read that returns one is a disclosure about a child, and
 * the difference is the whole point of logging.
 *
 * Listed here rather than derived from the policy model on purpose: the model
 * says which capability GATES a column, and this says which columns are worth
 * recording when they come back. They overlap heavily and are not the same
 * question — a column can be masked for tidiness and a column can be sensitive
 * without being masked from anyone who can already reach the row.
 */
export const RESTRICTED_FIELDS = Object.freeze({
  players:  ["email", "phone", "born", "hometown", "houseatschool",
             "address", "guardian", "height", "weight", "id_number"],
  injuries: ["injury_type", "severity", "phase", "notes", "physio"],
  career:   [],
  skills:   ["score"],
  users:    ["email"],
  // Dotted, because a rating is nested. What is disclosed here is a named
  // coach's judgement of a named child and the number it has moved to — which
  // is the development record, and as restricted as the assessment it is
  // derived from.
  ratings:  ["batting.coach", "batting.value", "bowling.coach", "bowling.value"],
});

/** Read a possibly-dotted path off a row. Flat names behave exactly as before. */
const pick = (row, path) =>
  path.split(".").reduce((v, k) => (v == null ? v : v[k]), row);

/** Which id column identifies the CHILD a row is about, for the log. */
const SUBJECT_ID = { players: "id", injuries: "player_id", skills: "player_id",
                     users: "id", ratings: "player_id" };

/** At most this many ids per entry. A log row is evidence, not a data export. */
const MAX_LOGGED_IDS = 500;

/**
 * Read a resource under the caller's principal.
 * @returns rows already row-filtered (RLS) and column-masked (views).
 */
export async function readResource(pool, secret, bearer, resource, query = {}) {
  const def = READ_QUERIES[resource];
  if (!def) { const e = new Error("unknown_resource"); e.status = 404; throw e; }
  const params = def.params ? def.params(query) : [];
  return runAsPrincipal(pool, secret, bearer, async client => {
    const { rows: raw } = await client.query(def.text, params);
    const rows = def.compose ? def.compose(raw) : raw;

    // Log what was ACTUALLY RECEIVED, not what was asked for. Masking is per
    // row and per capability, so two people running this same query get
    // different columns back — logging the query would record a disclosure
    // that never happened for one of them.
    const watched = RESTRICTED_FIELDS[resource];
    if (watched?.length && rows.length) {
      const disclosed = watched.filter((f) => rows.some((r) => pick(r, f) != null));
      if (disclosed.length) {
        const idCol = SUBJECT_ID[resource];
        const ids = idCol
          ? [...new Set(rows.map((r) => r[idCol]).filter(Boolean))].slice(0, MAX_LOGGED_IDS)
          : [];
        const school = rows.find((r) => r.school_id)?.school_id ?? null;
        await client.query(
          `select log_restricted_read($1, $2::uuid[], $3::text[], $4::uuid)`,
          [resource, ids, disclosed, school]);
      }
    }
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
