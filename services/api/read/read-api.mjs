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
import { OWNER_OF_READ } from "@scrbrd/policy/modules";
import { toCsv } from "../io/csv.mjs";
import {
  DISCIPLINES, battingIndex, bowlingIndex, coachIndex, adjustedRating,
  SCALE_MIN, SCALE_MAX,
  fromRow, deriveInnings, deriveMatchPhases,
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
                  -- WHICH GAME. On the shared fixture read rather than behind a
                  -- per-sport one, because a school running cricket and hockey
                  -- needs both on one list — and a client that had to ask per
                  -- sport would be assembling the fixture list itself.
                  m.sport,
                  -- THE AWAY SIDE, when it is a school on SCRBRD. Null for the
                  -- ordinary case, where the opponent text is all there is.
                  m.away_school_id, m.away_team_code,
                  -- BOTH SIDES, NAMED, from either end of the fixture.
                  --
                  -- A shared row is read by two schools and school_id means
                  -- "the host" rather than "us" — so an away reader whose
                  -- client rendered school_id as itself would have every
                  -- fixture backwards. Through fixture_side_label(), which is
                  -- SECURITY DEFINER because the away school's coaches are not
                  -- attached to the host and so cannot read its row in the
                  -- school table. It returns a name and nothing else.
                  fixture_side_label(m.school_id, m.team_code)           as home_label,
                  fixture_side_label(m.away_school_id, m.away_team_code) as away_label,
                  -- WHICH END THIS READER IS AT, answered by the same decision
                  -- function the policy used to hand them the row. A reader who
                  -- holds fixture.read over the home side is at home; one who
                  -- got the row through the away scope is away. A platform
                  -- reader holds both and comes back 'home', which is correct
                  -- in the only sense available: they are not a participant.
                  (case when app_can('fixture.read', m.school_id, m.team_code,
                                     '00000000-0000-0000-0000-000000000000'::uuid, m.id)
                        then 'home' else 'away' end)                     as my_side,
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

  /**
   * Appointments, and WHO MADE EACH ONE.
   *
   * role_assignment is readable by the person it is about and by anyone
   * holding user.role.assign at its scope, so this needs no capability of its
   * own — the table's policy already decides, and a coach sees their own
   * appointments and nobody else's.
   *
   * The granter and the revoker are joined by NAME rather than returned as
   * ids, because "B Naicker appointed this coach on 3 March" is the sentence
   * somebody actually needs, and an administrator holding a pair of uuids has
   * to go and look both up. app_user is itself row-scoped, so a name the
   * reader may not see comes back null and the row still says WHEN — the
   * useful half survives.
   *
   * Withdrawn assignments are INCLUDED, deliberately. This is the audit
   * surface: "who used to be able to do this and who took it away" is the
   * question it exists to answer, and filtering to live rows would leave it
   * answering only the easy half.
   */
  assignments: {
    text: `select a.id, a.person_id, p.name as person_name,
                  a.role, a.school_id, a.team_code, a.fixture_id,
                  a.active, a.valid_from, a.valid_until,
                  a.created_at, a.created_by, g.name as granted_by_name,
                  a.revoked_at, a.revoked_by, r.name as revoked_by_name
             from role_assignment a
             left join app_user p on p.id = a.person_id
             left join app_user g on g.id = a.created_by
             left join app_user r on r.id = a.revoked_by
            where ($1::uuid is null or a.person_id = $1)
            order by a.active desc, a.created_at desc`,
    params: q => [q?.personId || null],
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
             -- NULL WHEN THE MODULE IS OFF, not zero.
             --
             -- The summary read is claimed by no module on purpose — a dozen
             -- screens depend on it, and refusing the whole read would take the
             -- dashboard down to switch off one card. But the FIGURES inside it
             -- still belong to modules, and a school that turned Injuries off
             -- and then read "3 active restrictions" on its own dashboard would
             -- be right to say the setting does not work.
             --
             -- Null rather than 0 for the reason stated about win_rate_pct
             -- below, which is the same reason: "no injuries" and "we do not
             -- run that module" are different facts, and 0 cannot tell them
             -- apart. The client renders an absent figure as an em dash.
             (case when my_feature_enabled('injuries')
                   then (select count(*)::int from injury_masked where restricted)
              end)                                                        as injuries_active,
             (select count(*)::int from notification n
                left join notification_read r
                       on r.notification_id = n.id and r.person_id = app_user_id()
               where r.person_id is null
                 and (n.expires_at is null or n.expires_at > now()))      as unread_alerts,
             (case when my_feature_enabled('training')
                   then (select count(*)::int from training_session
                          where starts_at >= date_trunc('week', now())
                            and starts_at <  date_trunc('week', now()) + interval '7 days')
              end)                                                        as sessions_this_week,
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

  /**
   * An innings in three parts: powerplay, middle, death.
   *
   * A coach who only sees "142 for 6" cannot tell whether the side lost the
   * powerplay or threw away the death, and those are different problems with
   * different answers in the nets.
   *
   * Read from ball_event_live, which is security_invoker, so the breakdown
   * covers exactly the deliveries this reader may see — the same rule as
   * /read/career. Two people can legitimately get different phase figures for
   * the same match, and that is the model working rather than a fault.
   *
   * Derived, never stored, folded through the same deriveInnings() the scorer's
   * device runs. A phase breakdown that disagreed with the scorecard beside it
   * would be worse than none: both look authoritative and nothing could say
   * which was right.
   */
  phases: {
    // `overs` is joined from the MATCH, not accepted from the caller. The phase
    // boundaries are computed from it, so a client that could name its own
    // over count could move the death overs and change what the numbers mean.
    // It also survives an abandoned innings: a log that stops at over 12 does
    // not make it a twelve-over match.
    text: `select b.innings, b.seq, b.epoch, b.kind, b.ball_type, b.value, b.shot,
                  b.contact, b.trajectory,
                  b.striker_id, b.non_striker_id, b.bowler_id, b.dismissed_id,
                  b.dismissal, b.payload,
                  m.overs
             from ball_event_live b
             join match m on m.id = b.match_id
            where b.match_id = $1
            order by b.innings, b.seq`,
    params: q => [req(q, "matchId")],
    compose: composePhases,
  },

  /**
   * Scouting candidates, for an accredited scout.
   *
   * Everything about who may see what lives in scouting_candidates() in the
   * database — accreditation, per-player consent, and an evidence floor, all
   * checked by that function itself. This entry exists only to expose it; the
   * SELECT has no WHERE clause of its own to get wrong, and no query parameter
   * to widen it with. An unaccredited scout, or anyone without scouting.read
   * at all, gets back zero rows rather than an error — the same shape as
   * every other resource here, so a client cannot tell "not verified yet"
   * from "no candidates today" and go looking for a workaround.
   */
  scouting_candidates: {
    text: `select * from scouting_candidates()`,
  },

  /**
   * Who is standing, scoped through the fixture like weather and the pitch.
   *
   * No join to app_user, deliberately. `person_name` is stored on the
   * appointment, so a reader who may see the fixture but not the staff
   * directory gets the umpire's name rather than a blank — a join here would
   * run under their own row-level security and quietly return nothing. See
   * match_official in db/08 for the rest of the reasoning.
   *
   * Withdrawn appointments are excluded: this answers "who is standing", not
   * "who was ever named". The rows are kept for the disputed-fixture case and
   * a report that needs them can ask for them explicitly.
   */
  officials: {
    text: `select match_id, duty, person_name, person_id, panel, appointed_at
             from match_official
            where not withdrawn
              and ($1::uuid is null or match_id = $1)
            order by duty, person_name`,
    params: q => [q?.matchId || null],
  },

  // The state of the square, scoped through the fixture exactly as weather is.
  // Nothing personal here, but a pitch-report table readable by anyone would
  // answer "does this school have a fixture on Saturday?" to whoever asked.
  pitch_report: {
    text: `select match_id, surface, grass, bounce, pace, favours,
                  covers_on, notes, bounce_rating, pace_rating, outfield, reported_at
             from match_pitch_report
            where ($1::uuid is null or match_id = $1)`,
    params: q => [q?.matchId || null],
  },

  /**
   * The overlay's state, already masked.
   *
   * Everything a broadcast screen shows, and nothing else. The function is
   * SECURITY DEFINER and returns no rows for a fixture nobody has published,
   * so the publication row stands in for the viewer's permission — an overlay
   * is watched by people with no account and cannot lean on theirs.
   *
   * Names arrive ALREADY REDUCED to whatever the school chose. If a fixture is
   * set to initials, no full name is in this payload: not in a field the
   * widget declines to render, not in a console, not in a screenshot of a
   * network tab. The widget is presentation; this is the security.
   */
  broadcast_state: {
    text: `select * from broadcast_state($1)`,
    params: q => [req(q, "matchId")],
  },

  /**
   * The school's sponsors, and what may be advertised at all.
   *
   * Read under sponsorship.read via the table's own policy — a school office
   * sees its own sponsors and nobody else's, and a coach sees none, because a
   * list of who a school is negotiating with is commercial information about
   * the school even though the logos end up on a boundary board.
   */
  sponsors: {
    text: `select s.id, s.name, s.category, s.logo_text, s.logo_bg, s.active,
                  c.permitted as category_permitted, c.note as category_note
             from sponsor s join sponsor_category c on c.name = s.category
            order by s.active desc, lower(s.name)`,
  },

  /**
   * The vocabulary itself, permitted and prohibited alike.
   *
   * The refused categories ARE returned, with the note that says why. A form
   * that simply omits alcohol and betting teaches a school office nothing and
   * leaves them to discover the refusal by being refused; a form that shows
   * them greyed out with a reason has already had the conversation.
   */
  sponsor_categories: {
    text: `select name, permitted, note from sponsor_category order by permitted desc, name`,
  },

  /**
   * Placements, WITH THE TERMS MASKED.
   *
   * sponsorship_masked, never the base table — the rule at the top of this
   * file, and this is the case it was written for. contract_value_zar and
   * school_share_pct come back NULL for anybody without
   * sponsorship.finance.read, decided per row inside the view rather than by
   * this query choosing which columns to name. A query that omitted the
   * columns instead would be one edit away from a leak; the view is not.
   */
  sponsorships: {
    text: `select sm.id, sm.sponsor_id, sp.name as sponsor_name, sp.category,
                  sp.logo_text, sp.logo_bg,
                  sm.placement, sm.match_id, sm.starts_on, sm.ends_on,
                  sm.contract_value_zar, sm.school_share_pct, sm.agreed_at,
                  -- Exclusivity is NOT masked, unlike the money beside it. A
                  -- promise that this category is spoken for is the thing
                  -- everybody placing a board needs to know BEFORE they try;
                  -- keeping it behind the finance capability would mean the
                  -- people most likely to breach it are the ones who cannot
                  -- see it. What was PAID stays confidential; what was
                  -- PROMISED does not.
                  sm.exclusive, sm.exclusive_scope, sm.competition_id,
                  sm.waiver_note is not null as waived,
                  -- Named is_running rather than live: every adapter in
                  -- apps/web/src/lib/live.js sets live: true to mean "this row
                  -- came from the server rather than the mock", and a column
                  -- called live would land in that same field and quietly
                  -- become the flag.
                  (current_date between sm.starts_on and sm.ends_on) as is_running
             from sponsorship_masked sm
             join sponsor sp on sp.id = sm.sponsor_id
            where ($1::uuid is null or sm.match_id = $1 or sm.match_id is null)
            order by sm.starts_on desc`,
    params: q => [q?.matchId || null],
  },

  /**
   * Which product features are on.
   *
   * Readable by anyone signed in, because a client has to know what to render
   * and a client that has to guess will guess wrong. It discloses nothing: a
   * flag says what the product offers, never who may see what.
   */
  feature_flags: {
    text: `select key, enabled, reason, changed_at from feature_flag order by key`,
  },

  /**
   * The fleet. Read in the floor bundle, because a parent asking which bus
   * their son is on is the point of the screen.
   *
   * next_service_on is here so the Logistics screen can count what is due.
   * That figure used to be computed in the browser over a mock array hung on
   * the staff record, which meant it was the same number for every reader and
   * true for none of them.
   */
  vehicles: {
    text: `select id, registration, description, kind, capacity, condition,
                  next_service_on, active, notes, school_id
             from vehicle
            where ($1::boolean is null or active = $1)
            order by active desc, registration`,
    params: q => [q?.active == null ? null : q.active === "true"],
  },

  /**
   * Trips to fixtures, with the vehicle and driver resolved.
   *
   * Scoped through the fixture like the officials and the conditions, so a
   * team-scoped coach sees their own side's transport. The driver's name comes
   * through a join to app_user, which is itself row-scoped — a reader who may
   * not see the driver's account gets the trip without the name rather than no
   * trip, because knowing a bus is arranged is the useful half.
   */
  trips: {
    text: `select t.id, t.match_id, t.school_id,
                  t.vehicle_id, v.registration, v.description as vehicle_description,
                  v.capacity, v.kind,
                  t.driver_id, du.name as driver_name,
                  t.depart_at, t.return_at, t.pickup, t.seats_taken, t.notes,
                  t.departed_at, t.arrived_at, t.cancelled_at,
                  t.arranged_at,
                  -- Where the bus is, as one word, so a screen does not have to
                  -- re-derive it from three timestamps and get it wrong.
                  case when t.cancelled_at is not null then 'cancelled'
                       when t.arrived_at   is not null then 'arrived'
                       when t.departed_at  is not null then 'under_way'
                       else 'scheduled' end            as state
             from trip t
             left join vehicle v  on v.id = t.vehicle_id
             left join app_user du on du.id = t.driver_id
            where ($1::uuid is null or t.match_id = $1)
            order by t.depart_at nulls last`,
    params: q => [q?.matchId || null],
  },

  /**
   * Who can play on Saturday — INCLUDING WHO HAS NOT ANSWERED.
   *
   * The rows that do not exist are the point of this query. A team manager
   * chasing a side needs the boys who have said nothing, and a read that
   * returned only declarations would leave them counting the squad by hand and
   * subtracting. So it starts from the ROSTER for the fixture's team and left
   * joins the declarations onto it; silence comes back as status null, which
   * the client renders as "no answer" and never as available.
   *
   * The roster comes from `player`, which is itself row-scoped — so the list a
   * coach gets is the boys they may read, and a coach scoped to one side does
   * not learn who is in another. The availability join is scoped again by its
   * own policy on top of that.
   *
   * fit_note carries the OTHER half of the picture and is deliberately thin:
   * whether the physio has this boy restricted, and nothing about why. A
   * selector needs to know he is unavailable on clinical grounds; the
   * diagnosis is behind medical.nature.read and does not belong in a squad
   * list. Where the reader lacks even medical.status.read the masked view
   * returns nothing and this is null, which is correct — they simply see the
   * family's answer.
   */
  availability: {
    text: `select p.id                as player_id,
                  p.full_name,
                  p.team_code,
                  a.status,
                  a.reason_kind,
                  a.note,
                  a.declared_at,
                  -- Who said it. A selector reading "declared by the coach"
                  -- knows to check on a Friday; "declared by the player" they
                  -- can take at face value.
                  -- Through a SECURITY DEFINER helper, not a join. app_user
                  -- is row-scoped, so a coach reading a parent's declaration
                  -- joined to NULL and "said so himself" became
                  -- indistinguishable from "we could not tell" — which is the
                  -- one distinction this column exists to draw.
                  coalesce(d.is_self, false) as self_declared,
                  d.name               as declared_by_name,
                  -- Gated on the Injuries module, exactly as the dashboard's
                  -- injuries_active figure is. This read belongs to no module
                  -- — chasing a side is not an Injuries feature — but the
                  -- clinical HALF of it does, and a school that switched
                  -- Injuries off and still saw restrictions on its squad
                  -- screen would be right to say the setting does not work.
                  --
                  -- Null, not false. "Nobody is restricted" and "we do not run
                  -- that module" are different facts and false cannot tell
                  -- them apart; a selector reading false would take it as a
                  -- clinical all-clear that nothing in the system asserted.
                  (case when my_feature_enabled('injuries')
                        then exists (select 1 from injury_masked i
                                      where i.player_id = p.id and i.restricted)
                   end)                 as clinically_restricted
             from match m
             join player p
               on p.school_id = m.school_id
              and p.team_code = m.team_code
             left join match_availability a
               on a.match_id = m.id and a.player_id = p.id
             left join lateral availability_declarant(p.id, a.declared_by) d on true
            where m.id = $1
            order by (a.status is null) desc, p.full_name`,
    params: q => [req(q, "matchId")],
  },

  /**
   * THE INTERSECTION, which a coach has until now done in his head.
   *
   * Three facts about one boy and one Saturday live in three tables owned by
   * three different people: the family says whether he is coming, the physio
   * says whether he is cleared, and the coach says whether he is picked. Every
   * one of them was readable on its own and nothing joined them, so the check
   * that a picked XI is actually a fit and willing XI happened on a Friday
   * afternoon by flicking between two screens. It is the kind of check that
   * works until the week somebody is busy.
   *
   * NOT A SCORE. The obvious shape for this is one number per boy — 0 to 100,
   * sort descending, pick the top eleven — and it is the wrong shape, for a
   * reason that is not about precision. A clinical restriction is the physio's
   * to lift and nobody else's; a family's declaration is not the coach's to
   * appeal. Those two have OPPOSITE consequences for what a selector should do
   * next, and a single number cannot say which one said no. So this returns a
   * resolved state AND both components, and the client shows the component
   * that decided.
   *
   * WORST WINS. `state` is the least favourable thing anybody has said, in the
   * order: restricted, unavailable, unanswered, doubtful, available. Silence
   * ranks below a doubtful answer deliberately — a boy who has not replied has
   * told us nothing, and the nothing is what needs chasing.
   *
   * NOTHING HERE READS player.fitness. That column is written by no route in
   * this product and already disagrees with the injury records it purports to
   * summarise; a fourth unmaintained opinion is not an input, it is a bug
   * waiting for somebody to trust it. The clinical answer comes from the
   * injury rows the physio actually maintains, and the readiness walk asserts
   * that changing fitness changes nothing here.
   *
   * The diagnosis stays behind its tier for free: this reads injury_masked,
   * which is security_invoker, so a coach at the availability tier gets
   * `restricted` and `rtw_date` and no injury_type, severity or phase. The
   * derivation deliberately does not depend on `phase` for exactly that
   * reason — phase is masked at that tier, and a state that quietly changed
   * according to who was asking would be worse than no state at all.
   */
  /**
   * WHO WAS IN A SIDE ON A DATE. The question the column could not answer.
   *
   * A ladder for last season, a cap for a debut, an honours board, a scout
   * asking who played in March — all of them want the side as it stood then,
   * and until now the answer was whoever happened to be in it today. Through
   * roster_on() in db/08 under the caller's own policies: it is the roster
   * they already hold, asked about another day.
   */
  roster_on: {
    text: `select r.player_id, p.full_name, r.team_code, r.joined_on, r.left_on
             from roster_on($1::uuid, $2::text, $3::date, coalesce($4::text, 'cricket')) r
             join player p on p.id = r.player_id
            order by p.full_name`,
    params: q => [req(q, "schoolId"), req(q, "teamCode"), req(q, "on"), q?.sport || null],
  },

  readiness: {
    text: `with clinical as (
                  -- Gated on Injuries like the availability read above and for
                  -- the same reason. When the module is off this side is
                  -- simply absent: the column comes back null and the state
                  -- falls back to the declaration alone. That is the school's
                  -- choice and not a bypass — no injury row changed, and the
                  -- physio's own screen still holds it.
                  select i.player_id,
                         bool_or(i.restricted)                              as restricted,
                         min(i.rtw_date) filter (where i.restricted)        as rtw_date
                    from injury_masked i
                   where my_feature_enabled('injuries')
                   group by i.player_id
                )
           select p.id                       as player_id,
                  p.full_name,
                  p.team_code,
                  -- THE FAMILY'S HALF, and its provenance, as the availability
                  -- read gives it. Same SECURITY DEFINER declarant helper for
                  -- the same reason: app_user is row-scoped, so joining it
                  -- would collapse "he said so himself" into "we could not
                  -- tell".
                  a.status                    as declared_status,
                  a.reason_kind,
                  coalesce(d.is_self, false)  as self_declared,
                  d.name                      as declared_by_name,
                  -- THE PHYSIO'S HALF, and null means ONE thing here: the
                  -- Injuries module is off, so no clinical opinion is being
                  -- collected at all. False means one was and it says he is
                  -- clear — no restricted injury row that this reader can see.
                  --
                  -- Keeping those two apart is the whole reason for the
                  -- coalesce. Left-joined raw, a boy with no injury history
                  -- came back null, indistinguishable from a school that had
                  -- switched the module off, and the one column a selector
                  -- would act on could not tell "cleared" from "not asked".
                  (case when my_feature_enabled('injuries')
                        then coalesce(c.restricted, false)
                   end)                        as clinically_restricted,
                  c.rtw_date,
                  -- THE COACH'S HALF. A withdrawn selection is not a selection
                  -- (every read of a squad has to say so), so it comes back
                  -- unpicked here.
                  (s.player_id is not null)   as selected,
                  s.side                      as selected_side,
                  s.batting_no,
                  case when c.restricted            then 'restricted'
                       when a.status = 'unavailable' then 'unavailable'
                       when a.status is null         then 'unanswered'
                       when a.status = 'doubtful'    then 'doubtful'
                       else                               'available'
                  end                         as state,
                  -- The row a selector needs to see first: somebody is in the
                  -- side who should not be. Derived from two columns of this
                  -- same row, so a client computing it could not get it wrong
                  -- — it is here because doing the join is the whole point of
                  -- the read, and leaving the conclusion to the caller would
                  -- put us back to flicking between screens.
                  case when s.player_id is null then null
                       when c.restricted             then 'selected_while_restricted'
                       when a.status = 'unavailable' then 'selected_while_unavailable'
                       when a.status is null         then 'selected_without_answer'
                  end                         as conflict
             from match m
             join player p
               on p.school_id = m.school_id
              and p.team_code = m.team_code
             left join match_availability a
               on a.match_id = m.id and a.player_id = p.id
             left join lateral availability_declarant(p.id, a.declared_by) d on true
             left join clinical c on c.player_id = p.id
             left join match_squad s
               on s.match_id = m.id and s.player_id = p.id and not s.withdrawn
            where m.id = $1
            -- Conflicts first, then the worst news, then alphabetically.
            order by (case when s.player_id is not null
                            and (c.restricted or a.status is distinct from 'available')
                           then 0 else 1 end),
                     (case when c.restricted            then 0
                           when a.status = 'unavailable' then 1
                           when a.status is null         then 2
                           when a.status = 'doubtful'    then 3
                           else                               4 end),
                     p.full_name`,
    params: q => [req(q, "matchId")],
  },

  /**
   * WHAT IS ON FOR ME — one row per switchable thing, already resolved.
   *
   * The client needs this to lay out a menu, and it must not compute the answer
   * itself: the resolution is three levels deep, and a browser that got it
   * wrong would either draw a destination that then refuses every read, or hide
   * one the school is paying for.
   *
   * This is NOT what enforces anything. readResource() refuses a switched-off
   * module's reads and the dispatcher refuses its writes, both by asking the
   * same function this does. If a client ignored every row here, it would gain
   * nothing but error messages.
   *
   * Never module-gated itself, for the obvious reason.
   */
  my_features: {
    text: `select f.key, f.kind, f.label, my_feature_enabled(f.key) as enabled
             from feature_flag f order by f.kind, f.key`,
  },

  /**
   * WHICH SPORTS THIS PERSON'S SCHOOLS RUN, and how much of each works.
   *
   * The shell drew this from a hard-coded array — CricketOS, FootballOS,
   * RugbyOS, HockeyOS, three of them marked `live: false` — which is a product
   * decision living in a component constant. It comes from the database now,
   * so a sport granted to a school appears without a deploy.
   *
   * TWO SEPARATE FACTS PER ROW, and collapsing them is what made the hard-coded
   * version misleading. `enabled` is whether this school has been granted the
   * sport; `engine` is how much of the product exists for it — 'scoring' means
   * the ball log, replay and analytics; 'fixtures' means everything
   * sport-agnostic (schedule, squad, availability, transport, officials) and no
   * scoring engine; 'none' means listed and not built. A school can be granted
   * a 'fixtures' sport and get real use out of it the same day, and the client
   * must be able to say so rather than implying a scorer's screen exists.
   *
   * Never module-gated, for the obvious reason: this is the catalogue that says
   * what is switched on.
   */
  sports: {
    text: `select s.code, s.label, s.engine, s.flag_key,
                  my_feature_enabled(s.flag_key) as enabled,
                  -- How many fixtures this reader can actually see in it,
                  -- through their own row scope. A sport that is on and empty
                  -- and a sport that is on and in use are different things to
                  -- a sportsmaster deciding whether anybody adopted it.
                  (select count(*)::int from match m where m.sport = s.code) as fixtures
             from sport s
            order by s.sort_order, s.label`,
  },

  /**
   * OPPOSITION INTELLIGENCE, the one deliberate crossing of the tenant line.
   *
   * Both reads are thin wrappers over SECURITY DEFINER functions in db/08 that
   * check three things before returning a row: the caller holds
   * opposition.read at THEIR side of this exact fixture, the fixture is a
   * head-to-head between two tenants, and the window before it is open. No
   * standing means no rows — not a refusal with a reason, because a reason
   * confirms the fixture exists.
   *
   * Nothing here filters, and nothing here must: the functions name every
   * column they return, and the cricket half of a player row is all that is in
   * them. What this file adds is the LOG. full_name is registered as a
   * restricted field below, so every squad that comes back is written to
   * access_log against the OTHER school — the school whose children were read
   * — with the ids of every boy in it. A parent at that school asking "who has
   * looked at my son's record" gets an answer that names the reader, the
   * fixture, and the day.
   */
  opposition_context: {
    text: `select * from opposition_context($1)`,
    params: q => [req(q, "matchId")],
  },
  opposition_squad: {
    text: `select * from opposition_squad($1)`,
    params: q => [req(q, "matchId")],
  },

  /**
   * WHERE A BOY HAS PLAYED, which until now was overwritten rather than kept.
   *
   * Derived rows only: nothing writes this table except the trigger on
   * player, so what comes back is the movement history exactly as the column
   * writes produced it. left_on null is the side he is in now.
   *
   * Row-scoped through the boy — the policy anchors the team dimension on his
   * CURRENT side, so the coach who may read him may read the rows that
   * explain him, and a guardian scoped to their own child gets that child's
   * history and no other's. moved_by resolves through the same masked user
   * read discipline as everywhere: the id travels, the name only when the
   * reader could see that person anyway.
   */
  memberships: {
    text: `select m.id, m.player_id, p.full_name, m.school_id, m.sport,
                  m.team_code, m.joined_on, m.left_on, m.reason,
                  m.moved_by,
                  (m.left_on is null) as current
             from team_membership m
             join player p on p.id = m.player_id
            where ($1::uuid is null or m.player_id = $1)
            order by m.joined_on desc, m.created_at desc`,
    params: q => [q?.playerId || null],
  },

  /**
   * MY PHONES, and there is no version of this read for anybody else.
   *
   * Every row comes from device_push_token, whose policy is `person_id =
   * app_user_id()` with no capability anywhere near it — so this returns the
   * caller's own devices and cannot be widened by a role. That is not
   * consistency for its own sake: a list of somebody's devices with the times
   * each was last seen is a movement trail, and no role in this product has a
   * reason to hold one.
   *
   * Retired rows are INCLUDED, because "signed out on the iPad in March" is
   * the answer to "why did I stop getting alerts" — and a settings screen that
   * showed only live registrations could not answer it.
   */
  my_devices: {
    text: `select t.id, t.platform, t.label, t.device_id,
                  t.registered_at, t.last_seen_at,
                  t.retired_at, t.retired_reason,
                  -- Never the token itself. It is the bearer credential for
                  -- pushing to that phone, it is useless to a person reading
                  -- their own settings, and a token in a JSON response is a
                  -- token in a browser cache and a proxy log.
                  right(t.token, 6) as token_tail
             from device_push_token t
            order by (t.retired_at is null) desc, t.last_seen_at desc`,
  },

  /**
   * The same switches with their reasons shown, for an administrator's screen.
   *
   * Three levels reported SEPARATELY rather than collapsed. "Analytics is off"
   * is not an answer somebody can act on; "the platform default is on, your
   * school was not granted it, and somebody here hid it from two people" is
   * three different conversations, and an administrator staring at one boolean
   * cannot tell which they are in.
   *
   * Readable by anyone signed in, like feature_flag itself. What the product
   * offers and whether a school has it is not a secret from that school —
   * the suppression rows name people, and naming somebody a module was hidden
   * from discloses nothing about them that the person who hid it did not
   * already know.
   */
  module_settings: {
    text: `select f.key, f.kind, f.label, f.enabled as platform_default,
                  f.locked, f.reason, f.changed_at,
                  g.granted as school_granted, g.note as grant_note,
                  -- Suppressions counted rather than listed here: the school-wide
                  -- one is a yes/no, and the per-person ones are a number the
                  -- screen can expand into names with the query below.
                  exists (select 1 from feature_suppression s
                           where s.key = f.key and s.school_id = $1
                             and s.person_id is null
                             and s.lifted_at is null)          as school_hidden,
                  (select count(*)::int from feature_suppression s
                    where s.key = f.key and s.school_id = $1
                      and s.person_id is not null
                      and s.lifted_at is null)                 as people_hidden,
                  feature_enabled(f.key, $1::uuid, null)       as resolved
             from feature_flag f
             left join feature_grant g on g.key = f.key and g.school_id = $1
            order by f.kind, f.key`,
    params: q => [req(q, "schoolId")],
  },

  /**
   * Who a module has been hidden from at one school.
   *
   * Separate from module_settings because it is a list of NAMED PEOPLE and the
   * settings screen is a list of switches — folding them together would mean
   * every render of the switch list carried every person any module was ever
   * hidden from.
   */
  module_suppressions: {
    text: `select s.key, s.school_id, s.person_id, u.name as person_name,
                  s.reason, s.hidden_at
             from feature_suppression s
             left join app_user u on u.id = s.person_id
            where s.school_id = $1
              and s.lifted_at is null
              and ($2::text is null or s.key = $2)
            order by s.key, u.name nulls first`,
    params: q => [req(q, "schoolId"), q?.key || null],
  },

  /**
   * Reviews for a match, scoped through the fixture like the officials and the
   * conditions.
   *
   * `evidence_source` is selected first among the descriptive columns because
   * it is the one a screen must not omit. A review rendered without saying
   * whether a person judged it or a camera measured it is the fabrication this
   * feature is switched off to avoid.
   */
  drs_reviews: {
    text: `select match_id, ball_seq, evidence_source, called_by, on_field, outcome,
                  pitching, impact, wickets, shot_offered, notes, reviewed_at
             from drs_review
            where ($1::uuid is null or match_id = $1)
            order by ball_seq`,
    params: q => [q?.matchId || null],
  },

  /**
   * Batter against bowler: the matchup, derived from the ball log.
   *
   * WHY THIS EXISTS AT ALL. ball_event.striker_id and bowler_id were added so
   * that attribution would be available to readers that are not the scoring
   * device — the column comment names "a career average in SQL, a heat map for
   * one batter, a bowler's spell" as the reason. The first two were built. This
   * is the third kind, and until now nothing asked the log the one question a
   * coach asks out loud before a fixture: how has this boy gone against this
   * bowler, and against bowling like his.
   *
   * The wicket rule is NOT restated here. `ball_type = 'W'` with a dismissal
   * that is not a run out is exactly the predicate player_bowling_career uses
   * (db/02_schema_scoring.sql), and two definitions of "wicket" that can drift
   * apart is precisely what this schema keeps removing. The dismissed player is
   * checked against the striker as well, because a run out at the far end
   * dismisses the other batter and would otherwise be filed against the wrong
   * matchup.
   *
   * `bowler_style` rides along so a screen can aggregate the pairs into what a
   * coach actually plans against — left-arm orthodox, right-arm quick — rather
   * than only naming individuals.
   *
   * SCOPE, as everywhere: ball_event_live is security_invoker, so this covers
   * the deliveries the reader may see and no others.
   */
  matchups: {
    text: `select b.striker_id                          as batter_id,
                  bat.full_name                         as batter_name,
                  b.bowler_id,
                  bowl.full_name                        as bowler_name,
                  bowl.bowling_style,
                  count(*) filter (where b.ball_type not in ('Wd','Nb'))::int  as balls,
                  -- Runs off the bat. Byes and leg byes are not the batter's,
                  -- which is the same split runs_conceded makes on the bowling
                  -- side of the same delivery.
                  coalesce(sum(case when b.ball_type in ('run','W','Nb')
                                    then coalesce(b.value,0) else 0 end), 0)::int as runs,
                  -- A dot is a legal delivery worth nothing, which is the rule
                  -- derivePhases already applies (packages/scoring/src/phases.mjs).
                  -- Not "the batter scored nothing": two byes are a legal ball
                  -- he did not score off, and counting it as a dot here would
                  -- give a phase breakdown and a matchup two different dot
                  -- counts for the same over. One definition, or neither means
                  -- anything.
                  count(*) filter (where b.ball_type not in ('Wd','Nb')
                                     and coalesce(b.value,0) = 0)::int          as dots,
                  count(*) filter (where b.value = 4)::int                     as fours,
                  count(*) filter (where b.value = 6)::int                     as sixes,
                  count(*) filter (
                    where b.ball_type = 'W'
                      and coalesce(b.dismissal,'') !~* 'run ?out'
                      and coalesce(b.dismissed_id, b.striker_id) = b.striker_id
                  )::int                                                       as dismissals
             from ball_event_live b
             join player bat  on bat.id  = b.striker_id
             join player bowl on bowl.id = b.bowler_id
            where b.kind = 'ball'
              and ($1::uuid is null or b.striker_id = $1)
              and ($2::uuid is null or b.bowler_id  = $2)
            group by b.striker_id, bat.full_name, b.bowler_id, bowl.full_name, bowl.bowling_style
            order by balls desc, bat.full_name`,
    params: q => [q?.batterId || null, q?.bowlerId || null],
  },

  /**
   * How much of the log a matchup can actually speak for.
   *
   * Most bowlers a school's batter faces are not SCRBRD players: a fixture
   * against a school that is not a tenant has no away roster, so the scorer
   * types a name and the delivery carries no bowler_id. Those balls are real
   * and they are invisible to the matchup query above.
   *
   * A screen that showed "12 balls faced" without saying it was silently
   * ignoring 300 others would be stating something false with a number on it.
   * So the coverage is its own read, like shot_point_coverage, and a view is
   * expected to say what it left out.
   */
  matchup_coverage: {
    text: `select count(*) filter (where striker_id is not null and bowler_id is not null)::int as attributable,
                  count(*) filter (where striker_id is null or bowler_id is null)::int         as unattributable,
                  count(*)::int                                                                 as deliveries
             from ball_event_live
            where kind = 'ball'
              and ($1::uuid is null or striker_id = $1)`,
    params: q => [q?.batterId || null],
  },

  /**
   * The head-to-head against a school, derived from the fixtures.
   *
   * NOTHING HERE IS STORED. beta-2 kept winsA/winsB/draws on the rivalry row;
   * a scorecard corrected in March would leave that tally wrong for ever with
   * nothing able to say which number was right. The `derby` table holds only
   * the name and the founding year — the parts no query could produce.
   *
   * SCOPE, AGAIN, IS THE POINT. This reads `match` and match_live_score, both
   * of which apply the reader's own row-level security, so the record covers
   * exactly the fixtures this person may see. Two people will legitimately get
   * different totals for the same rivalry. An "accurate" record computed over
   * matches the reader cannot see would disclose that those matches exist.
   *
   * WHO WON IS DERIVED FROM THE TOSS, NOT GUESSED. The innings order is
   * bats_first(), so a match whose toss was never recorded cannot be
   * attributed to either side — its scores are known and its winner is not.
   * Those are counted as `undecided` and reported rather than dropped or
   * assigned to whoever looks likelier: a rivalry that reads "won 6" when two
   * more were played and nobody knows how they went is a lie of omission.
   *
   * The first/second innings are taken by ORDER rather than by index, because
   * the log has carried both 0-based and 1-based innings numbers and the
   * ordering is true under either.
   */
  derby_record: {
    text: `
      with judged as (
        select m.school_id, m.opponent, m.team_code, m.starts_at,
               -- THE RIVAL'S IDENTITY, not its spelling.
               --
               -- This grouped on the opponent STRING alone, which meant a school that
               -- renamed itself, or an office that typed "Michaelhouse College"
               -- one term and "Michaelhouse" the next, became two rivals with
               -- half a record each. Where the away side is a tenant its id is
               -- the identity and the string is only a label; where it is not,
               -- the string is all there is and behaves exactly as before.
               coalesce(m.away_school_id::text, m.opponent) as rival_key,
               m.away_school_id,
               bats_first(t.won_by, t.decision) as bats_first,
               (select ls.runs from match_live_score ls
                 where ls.match_id = m.id order by ls.innings asc  limit 1) as first_runs,
               (select ls.runs from match_live_score ls
                 where ls.match_id = m.id order by ls.innings desc limit 1) as second_runs,
               (select count(*) from match_live_score ls where ls.match_id = m.id) as innings_played
          from match m
          left join match_toss t on t.match_id = m.id
         where m.status = 'complete'
           and ($2::text is null or m.team_code = $2)
      ),
      outcome as (
        select j.*,
               case
                 when innings_played < 2 or bats_first is null then 'undecided'
                 when first_runs = second_runs                 then 'tied'
                 -- The side batting first won exactly when it scored more;
                 -- whether that side is us is what bats_first answers.
                 when (first_runs > second_runs) = (bats_first = 'home') then 'won'
                 else 'lost'
               end as result
          from judged j
      )
      select o.school_id, o.opponent, o.rival_key, o.away_school_id,
             d.title, d.since_year,
             count(*)::int                                        as played,
             count(*) filter (where o.result = 'won')::int         as won,
             count(*) filter (where o.result = 'lost')::int        as lost,
             count(*) filter (where o.result = 'tied')::int        as tied,
             count(*) filter (where o.result = 'undecided')::int   as undecided,
             max(o.starts_at)                                      as last_played,
             (select json_agg(r) from (
                select e.starts_at, e.team_code, e.result, e.first_runs, e.second_runs
                  from outcome e
                 where e.school_id = o.school_id and e.rival_key = o.rival_key
                 order by e.starts_at desc limit 5) r)             as recent
        from outcome o
        left join derby d
          on d.school_id = o.school_id
         and lower(btrim(d.opponent)) = lower(btrim(o.opponent))
       where ($1::text is null or lower(btrim(o.opponent)) = lower(btrim($1)))
       -- Grouped by school as well as opponent: someone assigned at two
       -- schools must not have their two records against the same rival
       -- silently added together.
       -- Grouped on the identity, with the label carried along. Where the
       -- rival is a tenant, two spellings of its name collapse into one
       -- record — which is the point of the column.
       group by o.school_id, o.rival_key, o.opponent, o.away_school_id,
                d.title, d.since_year
       order by played desc, o.opponent`,
    params: q => [q?.opponent || null, q?.teamCode || null],
  },

  /**
   * The groundsman's record of a ground, as opposed to a square prepared for
   * one fixture. Scoped by facility.read, which is in the floor bundle: a
   * captain choosing between spin and seam and a parent asking whether
   * Saturday will drain both legitimately want it, and it says nothing about
   * a person.
   */
  ground_conditions: {
    text: `select ground_id, moisture_pct, grass_mm, roller, outfield,
                  drainage_min, last_rolled, last_mown, notes, reported_at
             from ground_condition
            where ($1::uuid is null or ground_id = $1)`,
    params: q => [q?.groundId || null],
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
/**
 * Ball rows to a phase breakdown, per innings.
 *
 * The rows arrive flat and ordered; they are split by innings and each half
 * replayed. `fromRow()` is the only thing that turns a database row back into
 * an event — doing the mapping here by hand would be a second copy of a
 * vocabulary that has already drifted once in this codebase.
 *
 * The innings' over count comes from the match, joined in SQL, rather than
 * from the log or the caller. A log that stops at over 12 does not make it a
 * twelve-over match, and a caller who could name the figure could move the
 * death overs and change what every number on the card means.
 */
function composePhases(rows) {
  // Every row carries the match's over count, joined in SQL. Twenty is the
  // fallback for a match with none recorded, not a default anyone can send.
  const overs = Number.isFinite(rows[0]?.overs) ? rows[0].overs : 20;
  const byInnings = new Map();
  for (const r of rows) {
    const n = r.innings ?? 1;
    if (!byInnings.has(n)) byInnings.set(n, []);
    byInnings.get(n).push(fromRow(r));
  }
  const innings = [...byInnings.keys()].sort((a, b) => a - b)
    .map((n) => deriveInnings(
      [{ kind: "innings_start", overs, squad: [], bowlingSquad: [] }, ...byInnings.get(n)]));
  const { first, second } = deriveMatchPhases(innings);
  // One row per innings, so the shape matches every other read: a list.
  return [first, second]
    .map((ph, i) => (ph ? { innings: i + 1, phases: ph } : null))
    .filter(Boolean);
}

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
  // Another school's children, by name, read for a fixture. Logged against
  // the school that was read — school_id on every row is theirs, not the
  // reader's — so the disclosure lands in the right school's log.
  opposition_squad: ["full_name"],
});

/** Read a possibly-dotted path off a row. Flat names behave exactly as before. */
const pick = (row, path) =>
  path.split(".").reduce((v, k) => (v == null ? v : v[k]), row);

/** Which id column identifies the CHILD a row is about, for the log. */
const SUBJECT_ID = { players: "id", injuries: "player_id", skills: "player_id",
                     users: "id", ratings: "player_id", notes: "player_id",
                     opposition_squad: "player_id" };

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
  const module = OWNER_OF_READ[resource];
  return runAsPrincipal(pool, secret, bearer, async client => {
    // THE MODULE GATE, and it is here because this is the only door.
    //
    // Every governed read in the product goes through this function, so a
    // module switched off for a school genuinely stops delivering its rows —
    // not merely stops drawing its screen. A gate that only hid a menu entry
    // would be a setting whose name lies: anybody with a fetch call still had
    // the data, and a school administrator who thought they had turned
    // Injuries off would be wrong.
    //
    // AN AND, NEVER AN OR. This runs AFTER the caller's identity is set and
    // BEFORE the query, and it can only refuse. Row-level security decides
    // what comes back when it does not refuse; nothing here can hand anybody a
    // row they could not already read. That is what makes it safe to let a
    // school administrator throw these switches.
    //
    // 403 rather than 404: the resource exists, and telling somebody their
    // school has switched a module off is not a disclosure — they can see the
    // setting.
    if (module) {
      const { rows: [gate] } = await client.query(
        `select my_feature_enabled($1) as on`, [module]);
      if (!gate?.on) {
        const e = new Error("module_disabled");
        e.status = 403; e.code = "module_disabled"; e.module = module;
        throw e;
      }
    }
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

/**
 * The same read, as a file.
 *
 * EVERY GUARANTEE COMES FROM readResource() AND NONE FROM HERE. Row-level
 * security, the column masking views, the module gate and the restricted-read
 * entry in access_log all happen inside it, so an export is one ordinary read
 * that happens to be serialised differently. A school administrator
 * downloading a roster gets exactly the rows and exactly the columns the
 * screen would have shown them, and the disclosure is logged the same way.
 *
 * That is worth stating because the tempting implementation is a second query
 * — a fast path that selects straight from the table because it is "just an
 * export". That path would bypass the masking views, and the first person to
 * notice would be a coach with a spreadsheet of every pupil's home address.
 *
 * The column order is the FIRST ROW's key order, which is the query's own
 * SELECT order, so a term's exports diff against each other.
 */
export async function exportResource(pool, secret, bearer, resource, query = {}) {
  const rows = await readResource(pool, secret, bearer, resource, query);
  const columns = rows.length
    ? Object.keys(rows[0])
    // An empty result still needs a header, or the file a school opens is a
    // blank page rather than a roster with nobody in it. The columns come from
    // the query's own text in that case, which is the only place they exist.
    : columnsOf(resource);
  return { csv: toCsv(rows, columns), rows: rows.length, columns };
}

/**
 * The column names a resource returns, read off its SQL.
 *
 * Only ever used for an EMPTY export, so a file with no rows still carries a
 * header. Deliberately crude — the aliases in the SELECT list — and if it
 * cannot work them out it returns nothing rather than guessing, which produces
 * a headerless empty file instead of a file with invented columns.
 */
function columnsOf(resource) {
  const text = READ_QUERIES[resource]?.text ?? "";
  const select = text.match(/select\s+([\s\S]*?)\s+from\s/i)?.[1];
  if (!select) return [];
  // Split on commas that are not inside brackets: the SELECT lists contain
  // subqueries and function calls with commas of their own.
  const parts = [];
  let depth = 0, cur = "";
  for (const c of select) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts
    .map((p) => p.replace(/--[^\n]*/g, "").trim())
    .map((p) => (p.match(/\bas\s+([a-z_][a-z0-9_]*)\s*$/i)?.[1]
                 ?? p.match(/([a-z_][a-z0-9_]*)\s*$/i)?.[1] ?? "").toLowerCase())
    .filter(Boolean);
}

// ── Express/Fastify route: GET /export/:resource ──
//
// A separate route rather than a query parameter on the read, because the two
// have different response shapes and different headers, and a client that
// forgot the parameter should get JSON rather than a download.
export function exportRoute({ pool, secret }) {
  return async (req, res) => {
    try {
      const resource = req.params.resource;
      const { csv, rows } = await exportResource(
        pool, secret, req.headers?.authorization, resource, req.query || {});
      // A filename with the day in it, because a school will download the same
      // roster in March and again in October and needs to tell them apart in
      // a downloads folder.
      const name = `scrbrd-${resource}-${new Date().toISOString().slice(0, 10)}.csv`;
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        // The row count as a header, so a caller can tell "no rows you may
        // see" from "the download failed" without parsing the body.
        "x-scrbrd-rows": String(rows),
      });
      res.end(csv);
    } catch (e) {
      res.status(e.status || 500).json({
        error: e.code || e.message, ...(e.module ? { module: e.module } : {}) });
    }
  };
}

// ── Express/Fastify route: GET /read/:resource ──
export function readRoute({ pool, secret }) {
  return async (req, res) => {
    try {
      const rows = await readResource(pool, secret, req.headers?.authorization, req.params.resource, req.query || {});
      res.json({ resource: req.params.resource, rows });
    } catch (e) {
      // `module` rides along on a module refusal so a client can say WHICH
      // one is off instead of rendering "could not load" — a screen that
      // reports a switched-off module as a failure sends somebody looking for
      // an outage that is a setting.
      res.status(e.status || 500).json({
        error: e.code || e.message, ...(e.module ? { module: e.module } : {}) });
    }
  };
}
