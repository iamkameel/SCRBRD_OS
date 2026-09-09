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
  SCALE_MIN, SCALE_MAX,
} from "@scrbrd/scoring";

// resource → query. `masked: true` documents (and lets tests assert) that the
// query reads a masking view. `params` maps request query → SQL params.
/**
 * The four disciplines, in a fixed order, so the query's parameter positions
 * and the composer's reading of them cannot drift apart.
 */
const DISCIPLINE_NAMES = Object.freeze(Object.keys(DISCIPLINES));

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
    // The toss joins in from match_toss rather than sitting on `match`. The
    // output names are unchanged, so nothing downstream had to move — but
    // `bats_first` is new, and it is the point of the move: the innings order
    // is now answered by the database instead of worked out in the browser
    // from a school name that might have matched neither side.
    text: `select m.id, m.school_id, m.team_code, m.opponent, m.starts_at,
                  m.format, m.overs, m.status,
                  t.won_by   as toss_won_by,
                  t.decision as toss_decision,
                  bats_first(t.won_by, t.decision) as bats_first,
                  t.called_at as toss_at,
                  g.name as ground
             from match m
             left join match_toss t on t.match_id = m.id
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
    text: ratingsQuery(),
    params: () => DISCIPLINE_NAMES.map((d) => DISCIPLINES[d]),
    compose: composeRatings,
  },

  /**
   * A coach's own writing about a player.
   *
   * Narrower than the ratings beside it: player.note.read, which the pupil and
   * the guardian do not hold. The policy anchors through the player's CURRENT
   * side, so a coach reads the notes of the children they actually coach.
   *
   * The author's NAME is joined in. A development note whose author is a uuid
   * is a note nobody can weigh — "who said this" is most of what a reader needs
   * before deciding what to do about it.
   */
  notes: {
    text: `select n.id, n.player_id, n.school_id, n.body, n.about_discipline,
                  n.adjustment, n.observed_on, n.created_at, n.updated_at,
                  n.author_id, a.name as author_name,
                  p.full_name, p.team_code
             from development_note n
             join player p on p.id = n.player_id
             left join app_user a on a.id = n.author_id
            order by n.observed_on desc, n.created_at desc`,
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
   * The dashboard's figures, and the reason they are here rather than in the
   * browser.
   *
   * Eleven KPI cards across the views were hard-coded string literals —
   * value="53", value="72%", value="48.2" — rendering identically for a
   * superadmin and a team coach because they were not computed from anything.
   * The two that WERE computed (injuries, unread alerts) were counted in the
   * browser with .filter().length over rows the server had already scoped.
   *
   * That second pattern is correct today and fragile by construction: it
   * requires shipping every row to the client to count it, and the day anyone
   * adds a LIMIT to a read query for performance, every badge silently becomes
   * a smaller-but-plausible number. Nothing would fail. The card would just be
   * wrong, and wrong in the direction that looks fine.
   *
   * So every figure is a scalar subquery HERE, against the same relation the
   * detail query for that resource reads — player_masked, injury_masked, and
   * so on, never the base tables. That is the whole point: an aggregate
   * discloses as surely as a row, so a count must receive the identical
   * authorisation scope as the records it counts. Two people will legitimately
   * see different numbers for the same school, and that is correct.
   *
   * `scope_players` and `scope_matches` come back with the figures so a card
   * can say what it was computed over. A partial figure presented as a total
   * is a worse failure than an absent one.
   */
  summary: {
    masked: true,
    text: `select
             (select count(*)::int from player_masked)                    as active_players,
             (select count(*)::int from injury_masked where restricted)   as injuries_active,
             (select count(*)::int from notification n
                left join notification_read r
                       on r.notification_id = n.id and r.person_id = app_user_id()
               where r.person_id is null
                 and (n.expires_at is null or n.expires_at > now()))      as unread_alerts,
             (select count(*)::int from training_session
               where starts_at >= date_trunc('week', now())
                 and starts_at <  date_trunc('week', now()) + interval '7 days')
                                                                          as sessions_this_week,
             (select count(*)::int from match where status = 'scheduled') as upcoming_matches,
             (select count(*)::int from match)                            as scope_matches,
             (select count(*)::int from player_masked)                    as scope_players,
             -- Played and won come from the same scoped rows, so the rate is
             -- computed over exactly the competitions this reader may see.
             -- NULL rather than zero when there is nothing to divide by: "no
             -- matches played" and "lost every match" are different facts and
             -- 0% cannot tell them apart.
             (select case when coalesce(sum(e.played), 0) = 0 then null
                          else round(100.0 * sum(e.won) / sum(e.played))::int end
                from competition_entrant e)                               as win_rate_pct,
             (select min(m.starts_at) from match m
               where m.starts_at > now() and m.status = 'scheduled')      as next_match_at,
             -- The viewer's OWN figures, when the viewer is a player. These
             -- replaced hard-coded "48.2" and "135" on the player and parent
             -- cards. Derived from ball_event_live through the career views,
             -- which are security_invoker, so they cover exactly the
             -- deliveries this person may see — the same rule as /read/career.
             --
             -- A guardian gets their child's figures the same way, because
             -- app_user.player_id is set for a pupil account only; a parent
             -- account resolves to NULL here and the card shows an em dash
             -- rather than somebody else's average.
             (select c.runs from player_batting_career c
               where c.player_id = (select u.player_id from app_user u
                                     where u.id = app_user_id()))         as my_runs,
             (select case when coalesce(d.dismissals, 0) = 0 then null
                          else round(c.runs::numeric / d.dismissals, 1) end
                from player_batting_career c
                left join player_dismissals d on d.player_id = c.player_id
               where c.player_id = (select u.player_id from app_user u
                                     where u.id = app_user_id()))         as my_batting_average,
             (select case when coalesce(c.balls_faced, 0) = 0 then null
                          else round(100.0 * c.runs / c.balls_faced) end
                from player_batting_career c
               where c.player_id = (select u.player_id from app_user u
                                     where u.id = app_user_id()))         as my_strike_rate`,
  },

  // The state of the square, scoped through the fixture exactly as weather is.
  // Nothing personal here, but a pitch-report table readable by anyone would
  // answer "does this school have a fixture on Saturday?" to whoever asked.
  pitch_report: {
    text: `select match_id, surface, grass, bounce, pace, favours,
                  covers_on, notes, reported_at
             from match_pitch_report
            where ($1::uuid is null or match_id = $1)`,
    params: q => [q?.matchId || null],
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
    text: `select s.match_id, s.player_id, s.side, s.batting_no, s.twelfth, p.full_name
             from match_squad s
             join player p on p.id = s.player_id
            where s.match_id = $1
              -- A withdrawn selection is kept, not deleted. Every read of a
              -- squad has to say so, or a side that changed on Friday shows
              -- thirteen names on Saturday.
              and not s.withdrawn
            order by s.side, s.batting_no nulls last`,
    params: q => [req(q, "matchId")],
  },
};

/**
 * The ratings query, GENERATED over the disciplines rather than written out.
 *
 * It was hand-written for batting and bowling, which was fine until fielding
 * and keeping needed the same treatment and the block had to be copied twice
 * more. Four near-identical forty-line laterals is four places to fix a bug in.
 *
 * Each discipline gets, independently:
 *   its own ANCHOR — the latest date any attribute it draws on was assessed.
 *     A coach who re-rates bowling has not re-rated batting.
 *   its own COACH SCORES — the latest score per attribute, so an assessment
 *     covering four attributes revises those four and leaves the rest standing.
 *   its own NOTE ADJUSTMENT — the sum of adjustments on notes written SINCE
 *     that anchor. Notes older than the anchor are already inside the judgement
 *     that superseded them, exactly as older deliveries are.
 *
 * Batting and bowling additionally get match evidence since their anchor.
 * Fielding and keeping get none, because the ball log records neither, and
 * their rating is the coach's number alone — which adjustedRating() already
 * says correctly rather than inventing a half.
 */
function ratingsQuery() {
  const cols = [], joins = [];
  DISCIPLINE_NAMES.forEach((d, i) => {
    const n = i + 1;
    cols.push(`${d}_a.anchor as ${d}_anchor`, `${d}_a.scores as ${d}_scores`,
              `coalesce(${d}_n.adjustment, 0) as ${d}_note_adjustment`,
              `coalesce(${d}_n.notes, 0) as ${d}_note_count`);
    joins.push(`
             left join lateral (
               select max(x.assessed_on) as anchor,
                      jsonb_object_agg(x.category || '.' || x.metric, x.score) as scores
                 from (select distinct on (s.category, s.metric)
                              s.category, s.metric, s.score, s.assessed_on
                         from player_skill s
                        where s.player_id = p.id
                          and (s.category || '.' || s.metric) = any($${n}::text[])
                        order by s.category, s.metric, s.assessed_on desc) x
             ) ${d}_a on true
             left join lateral (
               select sum(dn.adjustment)::int as adjustment, count(*)::int as notes
                 from development_note dn
                where dn.player_id = p.id
                  and dn.about_discipline = '${d}'
                  and dn.adjustment is not null
                  and (${d}_a.anchor is null or dn.observed_on >= ${d}_a.anchor)
             ) ${d}_n on true`);
  });
  return `select p.id as player_id, p.full_name, p.team_code, p.school_id,
                  ${cols.join(",\n                  ")},
                  coalesce(bs.runs, 0)          as runs,
                  coalesce(bs.balls_faced, 0)   as balls_faced,
                  coalesce(bd.dismissals, 0)    as dismissals,
                  coalesce(ws.runs_conceded, 0) as runs_conceded,
                  coalesce(ws.legal_balls, 0)   as balls_bowled,
                  coalesce(ws.wickets, 0)       as wickets
             from player p${joins.join("")}
             -- Evidence since the coach last looked. A date cast to timestamptz
             -- is midnight, so a match on the afternoon of the assessment day
             -- counts towards it — which is the right way round: the coach
             -- rated him in the nets that morning.
             left join lateral player_batting_since(p.id, batting_a.anchor::timestamptz) bs on true
             left join lateral (select player_dismissals_since(p.id, batting_a.anchor::timestamptz)
                                  as dismissals) bd on true
             left join lateral player_bowling_since(p.id, bowling_a.anchor::timestamptz) ws on true
            order by p.full_name`;
}

/**
 * Turn one ratings row into a rating per discipline, and their working.
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
    // The two disciplines the ball log can speak to. The others have no index
    // and adjustedRating() reports "coach" rather than inventing a half.
    const index = {
      batting: battingIndex({
        runs: Number(r.runs), ballsFaced: Number(r.balls_faced), dismissals: Number(r.dismissals),
      }),
      bowling: bowlingIndex({
        runsConceded: Number(r.runs_conceded), ballsBowled: Number(r.balls_bowled),
        wickets: Number(r.wickets),
      }),
    };
    const sample = { batting: Number(r.balls_faced), bowling: Number(r.balls_bowled) };

    const out = {
      player_id: r.player_id, full_name: r.full_name,
      team_code: r.team_code, school_id: r.school_id,
    };
    for (const d of DISCIPLINE_NAMES) {
      const assessed = coachIndex(r[`${d}_scores`] ?? {});
      const noteAdjustment = Number(r[`${d}_note_adjustment`] ?? 0);
      // Notes move the COACH'S HALF, not a third term. They are that coach's
      // judgement expressed between formal assessments, so they belong on the
      // side of the rating a coach owns — and a fresh assessment supersedes
      // them, because the SQL only sums notes written since the anchor.
      //
      // Clamped to the scale. Three notes at the cap must not be able to walk a
      // rating past 20 or below 1, which are the two ends a written anchor
      // defines.
      const anchor = assessed.value == null ? null
        : Math.min(SCALE_MAX, Math.max(SCALE_MIN, assessed.value + noteAdjustment));
      out[d] = {
        anchoredOn: r[`${d}_anchor`],
        attributes: assessed.metrics,
        coachAssessed: assessed.value,
        noteAdjustment,
        noteCount: Number(r[`${d}_note_count`] ?? 0),
        ...adjustedRating({ coach: anchor, performance: index[d]?.value ?? null,
                            sample: sample[d] ?? 0 }),
        index: index[d] ?? null,
      };
    }
    return out;
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
  ratings:  ["batting.coach", "batting.value", "bowling.coach", "bowling.value",
             "fielding.coach", "fielding.value", "keeping.coach", "keeping.value"],
  // A note is a named coach's candid writing about a named child, and the
  // group that may read it is deliberately narrow. Every read is logged, which
  // is what makes the narrowness answerable rather than merely convenient.
  notes:    ["body"],
});

/** Read a possibly-dotted path off a row. Flat names behave exactly as before. */
const pick = (row, path) =>
  path.split(".").reduce((v, k) => (v == null ? v : v[k]), row);

/** Which id column identifies the CHILD a row is about, for the log. */
const SUBJECT_ID = { players: "id", injuries: "player_id", skills: "player_id",
                     users: "id", ratings: "player_id", notes: "player_id" };

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
