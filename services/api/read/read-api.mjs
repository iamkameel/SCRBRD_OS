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
import { notExported, exportAllowed, exportDrops, exportNeeds, tablesIn } from "@scrbrd/policy/exports";
import { toCsv } from "../io/csv.mjs";
import {
  DISCIPLINES, battingIndex, bowlingIndex, coachIndex, adjustedRating,
  SCALE_MIN, SCALE_MAX,
  fromRow, deriveInnings, deriveMatchPhases, NON_DELIVERY, NB_RUNS_VALUES,
} from "@scrbrd/scoring";
/** @import { Pool, Handler, ApiRequest, RawResponse, DressedError } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs).

/**
 * A career figure the scorebook did not record stays NULL (SCRBRD-120 D12,
 * db/64): balls faced, fours, sixes, and a bowler's wides and no-balls are
 * `sum()` without a coalesce in the career views, so NULL means "nothing
 * behind this figure was recorded". Only a player with NO row in the view
 * (he has not batted, or bowled) reads 0, which is a fact. `alias` is the
 * left-joined view; `alias.player_id is null` says there was no row.
 */
const UNRECORDED_ZERO = (/** @type {string} */ alias, /** @type {string} */ col) =>
  `case when ${alias}.player_id is null then 0 else ${alias}.${col} end as ${col},`;

/**
 * How partial a player's record is, from player_unrecorded_figures joined as
 * `unrec` (summed over seasons for a lifetime read): the innings with no balls
 * and the runs in them, so a strike rate can be taken over the innings whose
 * balls are known; the innings with no fours or sixes, so a boundary count
 * reads "at least"; the bowling rows with no wides or no-balls. `book_innings`
 * (from `book`, over summary_batting_line) is how many of his batting innings
 * came from a scorebook, for the screens' one-line note.
 */
const UNRECORDED_COLUMNS = `coalesce(unrec.innings_without_balls, 0)::int      as innings_without_balls,
                  coalesce(unrec.runs_without_balls, 0)::int         as runs_without_balls,
                  coalesce(unrec.innings_without_boundaries, 0)::int as innings_without_boundaries,
                  coalesce(unrec.bowling_without_extras, 0)::int     as bowling_without_extras,
                  coalesce(book.batting_innings, 0)::int             as book_innings,`;

// The dismissals that are not the bowler's, as a SQL list, from the one set
// the reducer reads — so a query cannot restate the law differently.
const NOT_THE_BOWLERS = [...NON_DELIVERY].map((d) => `'${d}'`).join(", ");
// Runs that are the striker's, as SQL over ball_event `b`: runsOffBat() in
// packages/scoring. A no-ball's and a wicket ball's are, unless payload.nbRuns
// says byes or leg byes (SCRBRD-068; the Laws audit F5, db/121); one recorded
// before that has no nbRuns and was hit.
const OFF_THE_BAT_SQL = `(b.ball_type = 'run' or (b.ball_type in ('Nb','W')
  and coalesce(b.payload->>'nbRuns', '') not in (${[...NB_RUNS_VALUES].map((v) => `'${v}'`).join(", ")})))`;
// A boundary, not any four or six off the bat (boundaryHit(); the Laws audit
// F7, db/121's ball_boundary()): runs that did not reach the rope carry
// payload.boundary = false.
const BOUNDARY_SQL = `coalesce(b.payload->>'boundary', '') <> 'false'`;

// resource → query. `masked: true` documents (and lets tests assert) that the
// query reads a masking view. `params` maps request query → SQL params.
/**
 * The four disciplines, in a fixed order, so the query's parameter positions
 * and the composer's reading of them cannot drift apart.
 */
// Object.keys() of a frozen literal is exactly its keys.
const DISCIPLINE_NAMES = Object.freeze(/** @type {(keyof typeof DISCIPLINES)[]} */ (Object.keys(DISCIPLINES)));

/** The directive's bands youngest first, then Open, then a boy with no date of birth. */
const BAND_ORDER = (/** @type {string} */ col) =>
  `case ${col} when 'U13' then 1 when 'U14' then 2 when 'U15' then 3 when 'U16' then 4 when 'open' then 5 else 6 end`;

/**
 * One governed read.
 * @typedef {object} ReadQuery
 * @property {string} text                                   the SQL
 * @property {boolean} [masked]                              reads a *_masked view
 * @property {(q: Record<string, string>) => unknown[]} [params]  request query → SQL params
 * @property {(rows: any[]) => any[]} [compose]              rows → the answer, when judgement is applied in JS
 * @property {boolean} [logsItself]                          the SQL writes its own access_log row (a definer that
 *                                                           logs every call); the read path adds none of its own
 * @property {(q: Record<string, string>) => string[]} [logsReads]  a read of the record itself (the access log,
 *                                                           the support sessions): every answer that holds a row
 *                                                           not the reader's own is logged, under this resource;
 *                                                           the function names the ids the query asked about
 * @property {boolean} [noStore]                             answered with Cache-Control: no-store, so no browser,
 *                                                           proxy or service worker keeps a copy (a union's list)
 * @property {readonly string[]} [refuses]                   words the SQL raises as invalid_parameter_value
 *                                                           (22023); answered 422 with the word, not 500
 */

/** @type {Record<string, ReadQuery>} */
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
                  -- The school season the fixture falls in, by the calendar's
                  -- rule, so a screen never derives a season from a date.
                  -- season_for() on the Johannesburg date, through the one
                  -- function (db/44) that also files this fixture's runs and
                  -- wickets under a season for the career_by_season read.
                  school_season_of(m.starts_at) as season,
                  -- WHICH GAME. On the shared fixture read rather than behind a
                  -- per-sport one, because a school running cricket and hockey
                  -- needs both on one list — and a client that had to ask per
                  -- sport would be assembling the fixture list itself.
                  m.sport,
                  -- THE AWAY SIDE, when it is a school on SCRBRD. Null for the
                  -- ordinary case, where the opponent text is all there is.
                  m.away_school_id, m.away_team_code,
                  -- The competition it is played under, or null: a friendly
                  -- (SCRBRD-114, db/61). Set on every fixture the planner
                  -- publishes (SCRBRD-123).
                  m.competition_id,
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
                  -- Each side's short code (school.code, "HIL"), for where
                  -- the full name does not fit (the Match Centre's board at
                  -- phone width). Read through the school table's own policy,
                  -- so a reader gets the code of a school they are attached
                  -- to and NULL for the other; the screen then shortens the
                  -- label itself. Nothing is disclosed that the label has not.
                  (select s.code from school s where s.id = m.school_id)      as home_code,
                  (select s.code from school s where s.id = m.away_school_id) as away_code,
                  -- WHICH END THIS READER IS AT, answered by the same question
                  -- the policy used to hand them the row (db/106's
                  -- match_read, in its set-once shape). A reader at the home
                  -- end, as staff or as a boy's family (his side, or his name
                  -- on the home sheet when he plays up), is at home; one who
                  -- got the row through the away end is away. A platform
                  -- reader is at both and comes back 'home', which is correct
                  -- in the only sense available: they are not a participant.
                  -- Not the all-zeros person: for a parent at the host whose
                  -- only child there plays for the visitors, that answered
                  -- 'home'.
                  (case when app_can('fixture.read', m.school_id, m.team_code,
                                     'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, m.id)
                          or (m.id, m.school_id, coalesce(m.team_code, ''))
                             in (select r.match_id, r.school_id, coalesce(r.team_code, '')
                                   from my_fixture_ends('fixture.read') r)
                        then 'home' else 'away' end)                     as my_side,
                  t.won_by   as toss_won_by,
                  t.decision as toss_decision,
                  bats_first(t.won_by, t.decision) as bats_first,
                  t.called_at as toss_at,
                  g.name as ground,
                  -- WHETHER a ground is set, apart from its name: the ground
                  -- row is read under facility.read, which a scorer does not
                  -- hold, so for him the name is null on every fixture. The
                  -- scorer's home (GA-I13) must not read that as "no ground".
                  (m.ground_id is not null) as has_ground,
                  -- The ground's two named ends (db/67), both or neither.
                  g.end_a_name as ground_end_a, g.end_b_name as ground_end_b
             from match m
             left join match_toss t on t.match_id = m.id
             left join ground g on g.id = m.ground_id
            order by m.starts_at desc`,
  },
  live_score: {
    // super_over (db/71): the nth super over, NULL for a match innings — the
    // board's and the scorecard's "Super over 1" block.
    text: `select match_id, innings, runs, wickets, legal_balls, last_seq, last_ball_at, super_over
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
    text: `select pm.id, pm.school_id, s.name as school_name, pm.full_name, pm.team_code, pm.squad_no, pm.playing_role,
                  pm.batting_style, pm.bowling_arm, pm.bowling_style, pm.fitness,
                  pm.born, pm.hometown, pm.height, pm.weight,           -- masked per role
                  pm.address, pm.guardian, pm.id_number              -- masked per role
             from player_masked pm
             join school s on s.id = pm.school_id
            order by pm.full_name`,
  },
  injuries: {
    masked: true,
    // GA-I19 (db/111): emergency_services and next_review_on at the nature
    // tier, recorded_by at the clinical tier, recurs_injury_id (a link) at
    // the status tier. dso_notified_at is not read here: that the DSO was
    // told is the safeguarding record's, not the Injuries screen's.
    text: `select id, school_id, player_id, injury_type, severity, date_injured, rtw_date,
                  phase, restricted, notes, physio,          -- notes/physio masked per role
                  emergency_services, next_review_on,        -- nature tier (db/111)
                  recorded_by,                               -- clinical tier (db/111)
                  recurs_injury_id, created_at,
                  -- Whether he has left the school the injury is at, and
                  -- when: the screens' "left the school" mark (D11). Read
                  -- under the caller's own RLS on team_membership, so it is
                  -- the status tier's and widens nothing.
                  injury_left_on(player_id, school_id) as left_on,
                  (injury_left_on(player_id, school_id) is not null) as left_school
             from injury_masked
            order by date_injured desc`,
  },
  /**
   * ONE INJURY'S REVIEWS, as a dated history (GA-I19 D3, db/111). Each row
   * at the reader's own tier, from injury_review_masked: that a review
   * happened and what it left his availability as for anybody who reads the
   * injury row; the phase and the next review for the nature tier; the note
   * and its author for the clinical tier. A support session reads none (Q7).
   * Logged when a nature or clinical column comes back.
   */
  injury_reviews: {
    masked: true,
    text: `select r.id, r.school_id, r.player_id, r.injury_id, r.reviewed_at,
                  r.is_recording,                            -- the recording itself ("Recorded")
                  r.restricted_after, r.rtw_date_after,
                  r.phase_after, r.next_review_on,           -- nature tier
                  r.note, r.reviewed_by                      -- clinical tier
             from injury_review_masked r
            where r.injury_id = $1
            order by r.reviewed_at, r.id`,
    params: (q) => [req(q, "injuryId")],
  },
  /**
   * THE PHYSIO'S WORKLIST (GA-I19 D3, D8, db/111): every open injury she
   * holds medical.write over, each with one reason and its clock. Nobody
   * else gets a row, so nobody else has a count of reviews due to show
   * (D5). Every row is a nature-tier read of a child: logged on the reason.
   */
  injury_worklist: {
    text: `select w.injury_id, w.school_id, w.player_id, w.reason, w.since, w.due_on, w.days_over
             from injury_worklist() w`,
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
             -- The live log, as player_shot_points reads it: a delivery the
             -- scorer voided is not drawn on the match's wagon wheel.
             from ball_event_live b
            where b.match_id = $1
              and b.placement_source = 'point'
              and b.capture_profile in ('full','standard')
            order by b.seq`,
    params: q => [req(q, "matchId")],
  },
  /**
   * ONE BOY'S SHOTS, ACROSS EVERY INNINGS HE HAS PLAYED.
   *
   * shot_points above answers "where did this MATCH go", which is the scorer's
   * question. This answers the coach's: where does this batter score, and where
   * does he not. Same stored placements, different grain — and the second grain
   * had no query at all, so the wagon wheel existed only inside the live pad and
   * nothing on a player's own profile could draw it.
   *
   * Read through ball_event_live rather than ball_event: the view is
   * security_invoker, so the deliveries returned are exactly the ones this
   * reader may see, and it drops voided balls — a shot that was undone is not a
   * shot this boy played. The same rule the career views already follow.
   *
   * Sector-era balls are included deliberately. `theta` is the measured point
   * and `seg` the older eight-sector estimate; a wheel that silently dropped
   * the second would show a boy's first season as empty rather than as coarse,
   * so both come back and the drawing says which it got — capture_profile
   * carries that, and the chart already renders the distinction.
   */
  player_shot_points: {
    text: `select b.match_id, b.innings, b.seq, b.ball_type, b.value, b.shot,
                  b.theta, b.radius, b.seg, b.close_position, b.capture_profile,
                  -- placement_source is what tells a MEASURED point from a
                  -- sector estimate, and the wheel's geometry branches on it:
                  -- without it every ball falls through to the sector angle and
                  -- a season of exact placements is drawn as eight spokes.
                  b.placement_source,
                  b.striker_id, b.bowler_id,
                  m.starts_at,
                  -- What this ball's innings DECLARED it would capture
                  -- (SCRBRD-039, db/31). A career mixes innings, so the
                  -- heat map reads each ball against its own innings: a
                  -- sector from an innings declared 'standard' was never
                  -- asked for a point, and says so, rather than being counted
                  -- with the balls that should have had one and do not.
                  -- NULL is undeclared, which reads exactly as before.
                  d.declared_profile
             -- The career log (db/71): a super over's shots are no part of
             -- where a boy scores (SCRBRD-114 phase 3b, design §4).
             from ball_event_career b
             join match m on m.id = b.match_id
             left join innings_declared_profile d
                    on d.match_id = b.match_id and d.innings = b.innings
            where b.striker_id = $1
              -- The boy's own record, under player_read: a wheel across
              -- innings is his, as career is (SCRBRD-136/137 away visibility
              -- §4.2, db/97). Once the visiting school reads a shared
              -- fixture's balls, the log alone would draw the host's boy's
              -- wheel across every fixture the two schools have played.
              and exists (select 1 from player p where p.id = $1)
              and b.kind = 'ball'
              and (b.theta is not null or b.seg is not null)
            order by m.starts_at, b.seq`,
    params: q => [req(q, "playerId")],
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
    text: `select c.id, c.name, c.comp_type, c.format, c.age_group, c.gender, c.school_id,
                  c.level, s.label as season,
                  (select count(*)::int from competition_division d where d.competition_id = c.id) as divisions
             from competition c
             left join season s on s.id = c.season_id
            order by c.name`,
  },

  /* The calendar. Platform reference data: which seasons exist, at which level. */
  seasons: {
    text: `select id, level, label, starts_on, ends_on, cutoff_on,
                  sa_today() between starts_on and ends_on as current
             from season
            order by level, starts_on`,
  },

  /* A competition's tiers, in rank order. Reachable by whoever can reach the competition. */
  competition_divisions: {
    text: `select d.id, d.competition_id, d.code, d.name, d.rank,
                  (select count(*)::int from competition_entrant e where e.division_id = d.id) as entrants
             from competition_division d
            where d.competition_id = $1
            order by d.rank`,
    params: q => [req(q, "competitionId")],
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
    // player_id is the join between an ACCOUNT and a PERSON on a roster, and it
    // was not selected — so the Users table's own "Linked To" column read an
    // undefined field and printed an em dash for everybody, including the one
    // account that is linked. The column was right; the query was not.
    //
    // It is also what aligns this screen with Squad, Profiles and the passport:
    // a passport is keyed on the PLAYER, so without this link there is no way
    // to get from an account to the record it belongs to.
    //
    // A PUPIL'S LOGIN EMAIL IS THE OFFICE'S (db/118): app_user_email_seen()
    // answers it to the pupil himself and to a holder of guardian.link.manage
    // at his school (the office, the principal), and NULL to every other
    // user.read holder (finance, sponsorship, and the director of sport, who
    // appoints staff: Kameel, 28 Oct 2026, "The office alone, as A4 says").
    // An adult's email is unchanged.
    text: `select id, school_id, app_user_email_seen(id, school_id, email) as email,
                  name, role, active, last_seen_at, teams, player_id
             from app_user
            where active
            order by name`,
  },

  // EVERY ACCOUNT, DISABLED ONES INCLUDED (account lifecycle D5, slice 1).
  // `users` keeps its `where active`: Staff, Modules, Guardian link and the
  // transport book read it to pick a person to act on, and offering a disabled
  // account as a driver or a module grantee is the wrong default. People alone
  // needs the whole list — a disabled account it cannot find again is one it
  // cannot enable. Same table, same policy (db/09's app_user_read: user.read
  // at the account's school, or your own row), no new reach: the only rows this
  // adds to `users` are the inactive ones the same reader could already read.
  //
  // `mine` marks the reader's own row, so reading only yourself is not logged
  // (logsReads, as the access log and the support sessions are): a list of
  // other people's accounts, the disabled ones among them, is on the record,
  // one row per school, naming the accounts that came back.
  //
  // `status_changed_at` (slice 2, db/90): when the account last changed state,
  // read from account_status_change under ITS policy (user.invite at the
  // school, never the person; audit.read no longer opens it, READERS Q2,
  // db/116), so People says "disabled {date}" to the office and nothing more
  // to a reader who holds user.read alone: for them, and for an account
  // disabled before db/90, it is null.
  accounts: {
    // A pupil's email as in `users` (db/118).
    text: `select id, school_id, app_user_email_seen(id, school_id, email) as email,
                  name, role, active, last_seen_at, teams, player_id,
                  id = app_user_id() as mine,
                  (select max(c.changed_at) from account_status_change c where c.user_id = app_user.id) as status_changed_at
             from app_user
            order by name`,
    logsReads: () => [],
  },

  /**
   * A CHILD'S LINKS, EVERY STATE (account lifecycle slice 3, D12; db/109).
   *
   * Every guardian link of one child — pending, verified, rejected, revoked,
   * dated out — newest first, with who decided what and when, and how each
   * one ended. The office's read: it has to see the links to work them.
   *
   * WHO: user.role.assign or guardian.link.manage at the child's school,
   * asked here in so many words. db/01's assignment_subject_read already
   * admits those two (A4), but it also admits a parent to her OWN row, and
   * this read is not hers: she reads her links through her own screens. So a
   * parent, a coach and the DSO (who holds neither: SAFEGUARDING §1 item 2;
   * she reads a family through safeguarding_family(), inside a concern) get
   * nothing. `ending_reason` comes through guardian_link_ending's own policy
   * (D13): guardian.link.manage alone since db/116 (READERS_child_data Q2:
   * audit.read opens the access log and no reason). A reader who holds
   * user.role.assign and not that reads the link revoked, with no ending.
   *
   * NEVER PLATFORM-WIDE (Kameel, 15 October 2026): a platform-wide holder
   * (the platform administrator, the owner's key) reads a child's links only
   * inside a live support session at that school (db/22);
   * guardian_link_ending holds the same line in its own RESTRICTIVE policy.
   *
   * `born` is never read: `is_minor` is the server's word. Logged, every read
   * (logsReads): it lists the adults around a child, and "who read this boy's
   * family" is a question the DSO answers from the log.
   */
  child_links: {
    text: `select g.id as link_id, player_school(g.player_id) as school_id, g.player_id,
                  a.person_id as guardian_id, u.name as guardian_name, u.email as guardian_email,
                  u.active as account_active,
                  (a.active and (a.valid_from is null or a.valid_from <= sa_today())
                            and (a.valid_until is null or a.valid_until > sa_today())) as role_live,
                  g.relationship, g.verification_state, vb.name as verified_by_name, g.verified_at, g.verified_note,
                  g.consent_state, g.consent_version, g.consent_at,
                  g.valid_from, g.valid_until, cb.name as created_by_name, g.created_at,
                  (g.verification_state in ('pending', 'verified') and g.valid_from <= sa_today()
                     and (g.valid_until is null or g.valid_until > sa_today())) as live,
                  e.kind as ending_kind, e.ends_on as ending_on, e.ended_at, eb.name as ended_by_name,
                  e.reason as ending_reason,
                  s.registration_state as standing, s.is_minor, s.live_links, s.consented_links
             from assignment_subject g
             join role_assignment a on a.id = g.assignment_id and a.role = 'guardian'
             left join app_user u  on u.id = a.person_id
             left join app_user vb on vb.id = g.verified_by
             left join app_user cb on cb.id = g.created_by
             left join guardian_link_ending e on e.link_id = g.id
             left join app_user eb on eb.id = e.ended_by
             left join player_guardian_status s on s.player_id = g.player_id
            where g.player_id = $1::uuid
              and (app_can('guardian.link.manage', player_school(g.player_id), '*'::text,
                           '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
                   or app_can('user.role.assign', player_school(g.player_id), '*'::text,
                              '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
              and (not (select app_is_platform_wide())
                   or app_support_access_id(player_school(g.player_id)) is not null)
            order by g.created_at desc, g.id`,
    params: (q) => {
      const id = q?.playerId || null;
      if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        const e = /** @type {DressedError} */ (new Error("bad_param:playerId")); e.status = 400; throw e;
      }
      return [id];
    },
    logsReads: (q) => (q?.playerId ? [q.playerId] : []),
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
                  a.revoked_at, a.revoked_by, r.name as revoked_by_name,
                  assignment_suspended(a.id) as suspended,
                  rq.decided_note as granted_note
             from role_assignment a
             left join app_user p on p.id = a.person_id
             left join app_user g on g.id = a.created_by
             left join app_user r on r.id = a.revoked_by
             -- The request it answered, if any, as role_request's own policy
             -- lets this reader see it: a register grant's note says "from
             -- the staff register, row …, uploaded …" (db/92), for People's
             -- origin line.
             left join lateral (select q.decided_note from role_request q
                                 where q.assignment_id = a.id
                                 order by q.decided_at desc nulls last limit 1) rq on true
            where ($1::uuid is null or a.person_id = $1)
            order by a.active desc, a.created_at desc`,
    params: q => [q?.personId || null],
  },

  /**
   * THE GAPS db/10 AND db/11 COULD ONLY WARN ABOUT.
   *
   * A boy with no date of birth on record, and a guardian link db/10 had to
   * end for want of one — both used to exist only as a RAISE WARNING in a
   * migration log nobody rereads. Through dob_gaps() in db/19, gated exactly
   * like assignment_subject_read: user.role.assign or guardian.link.manage,
   * per row, at that boy's own school and team. Nothing here is filtered a
   * second time; if a row comes back, the function decided this person may
   * have it.
   */
  dob_gaps: {
    text: `select * from dob_gaps()`,
  },

  grounds: {
    // parent_id: the field a pitch lies on (SCRBRD-123, db/67), or null;
    // end_a_name/end_b_name: the strip's two named ends, both or neither.
    text: `select id, school_id, name, surface, parent_id, end_a_name, end_b_name
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
  // `injured` is never READ as a status (GA-I26a AH-D9): the register is a
  // side-shared table and the reason for an absence is a medical fact, which
  // lives behind medical.status.read. A row written before db/105 stopped the
  // word reads as `excused`; the route no longer writes it.
  training_attendance: {
    text: `select a.session_id, a.player_id,
                  case when a.status = 'injured' then 'excused' else a.status end as status,
                  p.full_name
             from training_attendance a
             join player p on p.id = a.player_id
            where ($1::uuid is null or a.session_id = $1)
            order by p.full_name`,
    // Optional: the whole register this person may see, or one session's.
    params: q => [q?.sessionId || null],
  },

  /**
   * A session's plan, keyed to the drill library (GA-I26a §1.3, db/105):
   * which drills, in order, for how long. Read under the session's own
   * team.read, through training_session_drill's policy; it names no boy.
   * The legacy free-text `drills` on `training` stays, drawn as "Other".
   */
  training_plan: {
    text: `select x.session_id, x.position, x.drill_id, d.name, d.category,
                  coalesce(x.minutes, d.duration_min) as minutes, x.minutes is null as default_minutes
             from training_session_drill x
             join drill d on d.id = x.drill_id
            where ($1::uuid is null or x.session_id = $1)
            order by x.session_id, x.position`,
    params: (q) => [UUID_RE.test(String(q?.sessionId ?? "")) ? q.sessionId : null],
  },

  // Development assessments. Governed by player.development.read, which
  // neither spectator nor guardian holds — a parent reads their child's
  // profile and availability, and a coaching judgement of their technique is
  // not a document the platform hands over on its own.
  //
  // STANDING rows only (db/104, GA-I26a AH-D5): a withdrawn score stays in the
  // table, struck, and is read through `skills_history`; here, where the
  // client takes the newest row per attribute as "where he stands", it would
  // be a judgement the coach took back. `id` so a score can be withdrawn and a
  // coaching point pinned to it.
  skills: {
    text: `select s.id, s.player_id, s.assessed_on, s.category, s.metric, s.score,
                  p.full_name, p.team_code
             from player_skill s
             join player p on p.id = s.player_id
            where s.withdrawn_at is null
            order by s.assessed_on desc, p.full_name`,
  },

  /**
   * Every score ever given one boy, withdrawn ones included and struck
   * (GA-I26a §4.1): the history strip. Same reader as `skills`
   * (player.development.read, the boy himself among them) and the same log:
   * each open is one access-log row against him (RESTRICTED_FIELDS). Who
   * gave each score, and who withdrew it and why. `school_id` so the log
   * lands at his school.
   */
  skills_history: {
    text: `select s.id, s.player_id, p.school_id, s.assessed_on, s.category, s.metric, s.score,
                  s.assessed_by, a.name as assessed_by_name,
                  s.withdrawn_at, s.withdrawn_by, w.name as withdrawn_by_name, s.withdrawn_reason
             from player_skill s
             join player p on p.id = s.player_id
             left join app_user a on a.id = s.assessed_by
             left join app_user w on w.id = s.withdrawn_by
            where ($1::uuid is null or s.player_id = $1)
            order by s.player_id, s.category, s.metric, s.assessed_on, s.id`,
    params: (q) => [UUID_RE.test(String(q?.playerId ?? "")) ? q.playerId : null],
  },

  /**
   * A boy's targets (GA-I26a §1.2, db/105), open and withdrawn, under
   * player.development.read for his current side: his coach, the assistant,
   * the director, and he himself. Met-or-not is READ, never stored: the
   * newest standing score on the metric, and the first standing score at or
   * above the target since it was set. `note_id` only where the reader may
   * read the note (staff); the boy reads the target, not the reasoning.
   * The score it stood on comes with whether it has since been withdrawn.
   */
  targets: {
    text: `select t.id, t.player_id, t.school_id, t.category, t.metric, t.target_score,
                  t.set_on, t.due_on, t.set_by, sb.name as set_by_name,
                  t.drill_id, d.name as drill_name, d.category as drill_category,
                  (select n.id from development_note n where n.id = t.note_id) as note_id,
                  t.from_skill_id, fs.score as from_score, fs.assessed_on as from_assessed_on,
                  fs.withdrawn_at is not null as from_withdrawn,
                  now_s.score as standing_score, now_s.assessed_on as standing_on,
                  (select min(r.assessed_on) from player_skill r
                    where r.player_id = t.player_id and r.category = t.category and r.metric = t.metric
                      and r.withdrawn_at is null and r.assessed_on >= t.set_on
                      and r.score >= t.target_score) as reached_on,
                  t.withdrawn_at, t.withdrawn_by, t.withdrawn_reason
             from development_target t
             left join app_user sb on sb.id = t.set_by
             left join drill d on d.id = t.drill_id
             left join player_skill fs on fs.id = t.from_skill_id
             left join lateral (
               select s.score, s.assessed_on from player_skill s
                where s.player_id = t.player_id and s.category = t.category and s.metric = t.metric
                  and s.withdrawn_at is null
                order by s.assessed_on desc, s.id desc limit 1) now_s on true
            where ($1::uuid is null or t.player_id = $1)
            order by t.player_id, t.withdrawn_at nulls first, t.set_on desc, t.created_at desc`,
    params: (q) => [UUID_RE.test(String(q?.playerId ?? "")) ? q.playerId : null],
  },

  /**
   * "Since the last look" (GA-I26a §4.2): one row per discipline for one
   * boy. The anchor is the newest STANDING assessment among the discipline's
   * attributes (DISCIPLINES, passed in as for `ratings`), and the window runs
   * from it — or from the day he joined his current side, if later — to now,
   * over his CURRENT side's sessions that were not cancelled.
   *
   * It counts what he ATTENDED and never what he missed (GA-I24-I25 D8):
   * present and late, the sessions that took a register at all, the plan's
   * drills and how often each ran, and per open target in the discipline how
   * often its drill ran and how often he was there for it. No absence figure,
   * no reason, no health word.
   *
   * Invoker rights, and a gate: the boy's row is returned only to a reader
   * who holds player.development.read for him (the same question his scores'
   * policy asks), so the team manager and a parent get no rows rather than a
   * panel of counts. Inside, row security is the floor: a reader who may not
   * read the side's sessions gets no session counts.
   */
  development_since: {
    text: `with b as (
             select p.id, p.school_id, p.team_code
               from player p
              where p.id = $1::uuid
                and app_can('player.development.read', p.school_id, p.team_code, p.id,
                            '00000000-0000-0000-0000-000000000000'::uuid)),
           disc(discipline, attrs, ord) as (
             values ('batting', $2::text[], 1), ('bowling', $3::text[], 2),
                    ('fielding', $4::text[], 3), ('keeping', $5::text[], 4)),
           a as (
             select b.id as player_id, b.school_id, b.team_code, disc.discipline, disc.attrs, disc.ord,
                    (select max(s.assessed_on) from player_skill s
                      where s.player_id = b.id and s.withdrawn_at is null
                        and (s.category || '.' || s.metric) = any(disc.attrs)) as anchor,
                    (select max(m.joined_on) from team_membership m
                      where m.player_id = b.id and m.left_on is null and m.team_code = b.team_code) as joined_on
               from b cross join disc),
           w as (
             select a.*, case when a.anchor is null then null
                              else greatest(a.anchor, coalesce(a.joined_on, a.anchor)) end as window_from
               from a),
           sess as (
             select w.discipline, t.id as session_id,
                    exists (select 1 from training_attendance r where r.session_id = t.id) as registered,
                    (select r.status from training_attendance r where r.session_id = t.id and r.player_id = w.player_id) as his
               from w join training_session t
                 on w.window_from is not null
                and t.school_id = w.school_id and t.team_code = w.team_code and not t.cancelled
                and t.starts_at >= (w.window_from::timestamp at time zone 'Africa/Johannesburg')
                and t.starts_at <= now())
           select w.player_id, w.school_id, w.team_code, w.discipline, w.anchor, w.joined_on, w.window_from,
                  case when w.window_from is null then null else
                    (select count(*) from sess where sess.discipline = w.discipline)::int end as sessions,
                  case when w.window_from is null then null else
                    (select count(*) from sess where sess.discipline = w.discipline and sess.registered)::int end as registered,
                  case when w.window_from is null then null else
                    (select count(*) from sess where sess.discipline = w.discipline and sess.his = 'present')::int end as present,
                  case when w.window_from is null then null else
                    (select count(*) from sess where sess.discipline = w.discipline and sess.his = 'late')::int end as late,
                  (select coalesce(jsonb_agg(jsonb_build_object('drillId', x.drill_id, 'name', x.name, 'times', x.times)
                                             order by x.times desc, x.name), '[]'::jsonb)
                     from (select k.drill_id, d.name, count(*)::int as times
                             from sess join training_session_drill k on k.session_id = sess.session_id
                             join drill d on d.id = k.drill_id
                            where sess.discipline = w.discipline
                            group by k.drill_id, d.name) x) as drills,
                  (select coalesce(jsonb_agg(jsonb_build_object(
                            'id', t.id, 'category', t.category, 'metric', t.metric, 'target_score', t.target_score,
                            'set_on', t.set_on, 'due_on', t.due_on, 'drillId', t.drill_id, 'drillName', d.name,
                            'drillRan', (select count(*) from sess join training_session_drill k
                                           on k.session_id = sess.session_id and k.drill_id = t.drill_id
                                          where sess.discipline = w.discipline),
                            'drillAttended', (select count(*) from sess join training_session_drill k
                                                on k.session_id = sess.session_id and k.drill_id = t.drill_id
                                               where sess.discipline = w.discipline and sess.his in ('present', 'late')))
                            order by t.category, t.metric), '[]'::jsonb)
                     from development_target t left join drill d on d.id = t.drill_id
                    where t.player_id = w.player_id and t.withdrawn_at is null
                      and (t.category || '.' || t.metric) = any(w.attrs)) as targets
             from w
            order by w.ord`,
    params: (q) => [UUID_RE.test(String(q?.playerId ?? "")) ? q.playerId : null,
                    ...DISCIPLINE_NAMES.map((d) => DISCIPLINES[d])],
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
   * NULL, which the evidence reads as no window at all, as
   * player_batting_since() does (ratingsQuery() has how). That is the
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
  //
  // A withdrawn note is still a note (db/104): it comes back struck, with who
  // withdrew it. `is_point` marks a coaching point; its pointer is read
  // through `coaching_points`.
  notes: {
    text: `select n.id, n.player_id, n.school_id, n.body, n.about_discipline,
                  n.adjustment, n.observed_on, n.created_at, n.updated_at,
                  n.author_id, a.name as author_name,
                  p.full_name, p.team_code,
                  n.withdrawn_at, n.withdrawn_by, n.evidence_read is not null as is_point
             from development_note n
             join player p on p.id = n.player_id
             left join app_user a on a.id = n.author_id
            order by n.observed_on desc, n.created_at desc`,
  },

  /**
   * Coaching points (GA-I27 C3–C4, built on the note by GA-I26a AH-D2): a
   * development_note carrying its evidence pointer. Read under the note's own
   * policy, player.note.read — coach, assistant, director, principal; never
   * the boy, his parents, a team-mate, the team manager, the analyst — and
   * logged as notes are. Withdrawn points come back struck. Optionally one
   * boy's, or one fixture's.
   */
  coaching_points: {
    text: `select n.id, n.player_id, n.school_id, n.body, n.observed_on, n.created_at,
                  n.author_id, a.name as author_name, p.full_name, p.team_code,
                  n.match_id, n.evidence_rule, n.evidence_read, n.evidence_params,
                  n.evidence_head, n.evidence_as_of, n.evidence_text,
                  n.withdrawn_at, n.withdrawn_by
             from development_note n
             join player p on p.id = n.player_id
             left join app_user a on a.id = n.author_id
            where n.evidence_read is not null
              and ($1::uuid is null or n.player_id = $1)
              and ($2::uuid is null or n.match_id = $2)
            order by n.created_at desc`,
    params: (q) => [UUID_RE.test(String(q?.playerId ?? "")) ? q.playerId : null,
                    UUID_RE.test(String(q?.matchId ?? "")) ? q.matchId : null],
  },

  /**
   * A disciplinary matter about a named child (SCRBRD-053).
   *
   * No masking view, because there is nothing to mask: discipline.read gates
   * the whole ROW, and a reader without it sees no record at all rather than a
   * record with its prose blanked. Masking is the wrong instrument here: a
   * matter with its account removed still says a named boy is in trouble and
   * no longer says what for, which discloses the fact and withholds the only
   * part that would let a reader weigh it.
   *
   * LEFT JOIN on player, not JOIN. A reader who holds discipline.read and
   * not player.profile.read over the boy (the owner's key is the only such
   * reader since READERS_child_data Q10 took the league's discipline.read
   * away, db/116) gets the record without the child's name rather than an
   * empty list that looks like a clean record. The league reads its own
   * fixtures' records through `competition_discipline` below.
   *
   * `playerId`, optional, narrows to one child — which is how the Conduct tab
   * on a boy's profile asks. It is a narrowing, never a widening (RLS has
   * already decided the set), and it matters for the LOG as much as for the
   * wire: every row returned is logged below as a read of that child's
   * record, so a profile that fetched the whole school's matters to show one
   * boy's would put every other child's name in the access log as read.
   */
  disciplinary_records: {
    text: `select d.id, d.player_id, d.school_id, d.match_id, d.body,
                  d.state, d.outcome, d.occurred_on, d.created_at, d.updated_at,
                  d.recorded_by, u.name as recorded_by_name,
                  p.full_name, p.team_code
             from disciplinary_record d
             left join player p   on p.id = d.player_id
             left join app_user u on u.id = d.recorded_by
            where ($1::uuid is null or d.player_id = $1::uuid)
            order by d.occurred_on desc, d.created_at desc`,
    params: (q) => {
      const id = q?.playerId || null;
      if (id && !/^[0-9a-f-]{36}$/i.test(id)) {
        const e = /** @type {DressedError} */ (new Error("bad_param:playerId")); e.status = 400; throw e;
      }
      return [id];
    },
  },

  /**
   * A LEAGUE'S CONDUCT RECORDS (READERS_child_data Q10, Kameel, 21 Oct 2026;
   * db/116). The records that arose from a fixture in a competition the
   * reader organises, through competition_discipline_records(): the umpire's
   * report on its own match, never a school's file and never a matter filed
   * without a fixture. competition.discipline.read at the competition's
   * organiser is the gate, inside the function; nothing here filters.
   *
   * The function writes the log itself (logsItself): one row per school
   * whose children it names, under that school, so each school's auditor
   * sees the league's read of its boys in its own log. `competitionId`,
   * optional, narrows to one competition; without it, every competition the
   * reader organises.
   */
  competition_discipline: {
    text: `select id, player_id, full_name, school_id, school_name, match_id, competition_id,
                  opponent, starts_at, occurred_on, body, state, outcome, created_at, updated_at
             from competition_discipline_records($1::uuid)`,
    params: (q) => {
      const id = q?.competitionId || null;
      if (id && !UUID_RE.test(id)) {
        const e = /** @type {DressedError} */ (new Error("bad_param:competitionId")); e.status = 400; throw e;
      }
      return [id];
    },
    logsItself: true,
  },

  /**
   * A COACH'S OWN SIDE'S CONDUCT RECORDS (READERS_child_data Q5, Kameel,
   * 21 Oct 2026: "own side, logged"; db/116). Through side_discipline_records():
   * the records of the boys on the side his assignment names, as each boy
   * stands today, never a boy who has left. discipline.side.read is the gate,
   * inside the function; a coach holds no discipline.read. The function writes
   * the log itself (logsItself), one row per school per call that returns a
   * record. `playerId`, optional, narrows to one boy.
   */
  side_discipline: {
    text: `select id, player_id, full_name, team_code, school_id, match_id,
                  occurred_on, body, state, outcome, created_at, updated_at
             from side_discipline_records($1::uuid)`,
    params: (q) => {
      const id = q?.playerId || null;
      if (id && !UUID_RE.test(id)) {
        const e = /** @type {DressedError} */ (new Error("bad_param:playerId")); e.status = 400; throw e;
      }
      return [id];
    },
    logsItself: true,
  },

  // The newsfeed. Same rule as every read here: the policy on news_post has
  // already decided who may see each row — a team post reaches that side, a
  // school post that school, a competition post every school entered in it —
  // so this query orders and names, and does no filtering that looks like an
  // authorization check.
  //
  // The author's own drafts come back too, by the second SELECT policy, which
  // is why published_at is returned rather than assumed: the screen shows a
  // draft as a draft instead of as a notice nobody else can see.
  //
  // The public home page (SCRBRD-142 §3.5, db/83): each post's latest
  // request, as news_post_public's own policy lets this reader see it — the
  // author's, and the school's publishers'; to anybody else no row, so no
  // state. may_approve and may_take_down say which buttons the screen offers;
  // the doors decide again (news_public_approve() also refuses the author).
  // public_names is the scan's count on a waiting request, for the approvals
  // card's warning: news_public_check() answers the author and the school's
  // publishers, and NULL to anybody else.
  //
  // The coach's plan (db/96, SCRBRD-138 phase B §2.2): `kind` is 'post' or
  // 'plan', and `fixtureId` the match a plan is for, so the fixture screen
  // picks kind === 'plan' && fixtureId === match.id (PlanBlock, C1's line,
  // the Captain tab's row). Who reads a plan is the policies' (db/12, and
  // db/96's narrowing to the side); nothing here filters. `noticeId` is the
  // live plan's notice as this reader may read it, for the block's Report
  // button: notification_report() takes a notice's id, not a post's (the
  // lead's note on PB-D12). Null for an ordinary post, a draft, or a notice
  // this reader does not have.
  //
  // The plan's byline (db/103, CSA SG-9: a pupil knows which adult wrote to
  // his side). The author's name is the app_user join where this reader may
  // read the author's account; for a live plan it is otherwise
  // plan_author_name(), which names the author of a plan this reader already
  // reads and nothing else. An ordinary post is as before: a pupil and a
  // parent hold no user.read, so its author_name stays null for them.
  //
  // A draft plan (db/110): `wasSent` says whether it was ever sent, so the
  // coach's tab offers Delete only on one never sent (a withdrawn plan is
  // kept), and `urgency` refills the composer's "Send to phones too" when he
  // changes it.
  //
  // `fixtureId`, optional, narrows to one fixture's posts (its plans: a post
  // has no fixture), so the fixture screen finds the plan however many newer
  // posts there are; the list is otherwise the newest 100. A narrowing, never
  // a widening: the policies have already decided the set.
  news: {
    text: `select n.id, n.scope, n.school_id, n.team_code, n.competition_id,
                  n.kind, n.fixture_id as "fixtureId",
                  case when n.kind = 'plan' and n.published_at is not null then (
                    select x.id from notification x
                     where x.kind = 'notice' and x.subject_kind = 'news' and x.subject_id = n.id
                       and x.retracts_id is null and x.retracted_at is null
                     order by x.published_at desc limit 1) end as "noticeId",
                  n.title, n.body, n.published_at, n.created_at,
                  n.urgency, (n.first_sent_at is not null) as "wasSent",
                  s.name as school_name, c.name as competition_name,
                  coalesce(u.name, case when n.kind = 'plan' then plan_author_name(n.id) end) as author_name,
                  (n.author_id = app_user_id()) as mine,
                  coalesce(app_can('broadcast.publish', n.school_id, null::text,
                                   '00000000-0000-0000-0000-000000000000'::uuid,
                                   '00000000-0000-0000-0000-000000000000'::uuid), false) as may_approve,
                  coalesce(app_can('broadcast.publish', n.school_id, '*'::text,
                                   '00000000-0000-0000-0000-000000000000'::uuid,
                                   '00000000-0000-0000-0000-000000000000'::uuid), false) as may_take_down,
                  pp.state as public_state,
                  case when pp.state = 'requested' then news_public_check(n.id) end as public_names,
                  -- db/118: the word of the post that matched, for the same readers.
                  case when pp.state = 'requested' then news_public_word(n.id) end as public_word
             from news_post n
             left join school s      on s.id = n.school_id
             left join competition c on c.id = n.competition_id
             left join app_user u    on u.id = n.author_id
             left join lateral (
               select case when q.withdrawn_at is not null then 'withdrawn'
                           when q.approved_at is null then 'requested'
                           when q.approved_digest = news_public_digest(n.scope, n.school_id, n.team_code, n.title, n.body)
                             then 'approved'
                           else 'edited' end as state
                 from news_post_public q
                where q.post_id = n.id
                order by (q.withdrawn_at is null) desc, q.requested_at desc
                limit 1) pp on true
            where ($1::uuid is null or n.fixture_id = $1::uuid)
            order by coalesce(n.published_at, n.created_at) desc
            limit 100`,
    params: (q) => {
      const id = q?.fixtureId || null;
      if (id && !UUID_RE.test(id)) {
        const e = /** @type {DressedError} */ (new Error("bad_param:fixtureId")); e.status = 400; throw e;
      }
      return [id];
    },
  },

  // Notices. The read policy demands news.read AND the capability each row
  // declares for its own subject matter, in the same scope — so this query
  // needs no filter of its own beyond ordering, and MUST NOT grow one that
  // looks like an authorization check. If a row comes back, the database
  // decided this person may have it.
  //
  // FROM my_notifications (db/89, NOTIFICATIONS.md D17): the policy read as
  // the caller, less what expired or was retracted, with the reader's own
  // receipt. The summary's unread_alerts counts the same view, so the badge
  // and the list cannot disagree. A tiered row (behind more than news.read)
  // comes with its title and no body: the body is read on open
  // (POST /api/notifications/:id/read), which logs it.
  //
  // LIMIT 200 bounds the list; the count is never taken from it.
  notifications: {
    text: `select n.id, n.school_id, n.team_code, n.scope_level, n.kind,
                  n.urgency, n.title, n.body, n.tiered, n.subject_kind, n.subject_id,
                  n.published_at, n.subject_person_id, n.retracts_id, n.read
             from my_notifications n
            order by n.published_at desc, n.id
            limit 200`,
  },

  // The league ladder. Readable whole by anyone who can reach the competition,
  // through the organiser or through any entrant — a log with one row in it is
  // not a log. Writing a row stays anchored to the entrant's own school.
  //
  // SCRBRD-114 phase 3a (db/69): read from competition_standing, the table
  // computed on every read from each match's result under its own frozen
  // table document — or, where a competition's points are not confirmed
  // (`basis` = 'entered'), the figures its schools typed, as before. Ranked
  // by the competition's table.order, equal sides sharing a rank. Accepted
  // entrants only (db/67), as before.
  league: {
    text: `select s.entrant_id as id, s.competition_id, s.school_id, s.team_code, s.display_name,
                  s.played, s.won, s.lost, s.tied, s.drawn, s.no_result, s.points,
                  s.nrr as net_run_rate, s.basis, s.rank, s.adjustment_points, s.conditions_adjusted,
                  -- The tier, when the competition has them. An entrant nobody
                  -- has placed sits after every division, not in a made-up one.
                  d.id as division_id, d.code as division_code, d.name as division_name, d.rank as division_rank
             from competition_standing s
             left join competition_division d on d.id = s.division_id
            where ($1::uuid is null or s.competition_id = $1)
            order by s.competition_id, d.rank nulls last, s.rank, s.display_name`,
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
             -- my_notifications, as the notifications read: one view, one count.
             (select count(*)::int from my_notifications where not read) as unread_alerts,
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
             -- Over the innings whose balls were recorded (SCRBRD-120 D12): an
             -- innings imported from a scorebook that has no balls column adds
             -- its runs to my_runs but not to this rate, which would else be
             -- overstated. NULL when no ball is recorded at all.
             (select case when coalesce(c.balls_faced, 0) = 0 then null
                          else round(100.0 * (c.runs - coalesce(uf.runs_without_balls, 0)) / c.balls_faced) end
                from player_batting_career c
                left join (select f.player_id, sum(f.runs_without_balls) as runs_without_balls
                             from player_unrecorded_figures f group by f.player_id) uf
                       on uf.player_id = c.player_id
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
                  m.overs, m.format
             from ball_event_live b
             join match m on m.id = b.match_id
            where b.match_id = $1
              -- A phase is an over number; a one-over super over would read
              -- as a powerplay (db/71, design §4: never).
              and b.super_over is null
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
    // db/125 §5 (2) (Kameel, 30 Oct 2026, seams call 2): the function writes
    // one access_log row per school whose boys it returned, so the read path
    // adds none (a platform-wide scout's was a second row).
    logsItself: true,
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
  //
  // SCRBRD-034 adds three columns and no reach. `id` is what the office's
  // link/suspend/lift controls name. `linked` says the duty rests on an
  // assignment (db/34) — a fact, not the assignment itself, which stays
  // behind role_assignment's own policy. `suspended` is duty_suspended(),
  // which answers only for a duty the reader could see anyway; WHY is the
  // office's record and is read from duty_suspensions below, not here.
  officials: {
    text: `select id, match_id, duty, person_name, person_id, official_id, panel, appointed_at,
                  assignment_id is not null as linked,
                  duty_suspended(id)          as suspended
             from match_official
            where not withdrawn
              and ($1::uuid is null or match_id = $1)
            order by duty, person_name`,
    params: q => [q?.matchId || null],
  },

  /**
   * The office's record of suspended duties (SCRBRD-034, db/34): who paused
   * a duty, when and why, and who lifted it, when and why. duty_suspension is
   * readable under user.role.assign at the school and by nobody else — not
   * the scorer it is about, who learns THAT they are suspended (the officials
   * read above, assignment_suspended()) and not the reason.
   */
  duty_suspensions: {
    text: `select s.id, s.duty_id, o.match_id, o.duty, o.person_name,
                  s.suspended_at, s.reason, sb.name as suspended_by_name,
                  s.lifted_at, s.lift_reason, lb.name as lifted_by_name
             from duty_suspension s
             left join match_official o on o.id = s.duty_id
             left join app_user sb on sb.id = s.suspended_by
             left join app_user lb on lb.id = s.lifted_by
            where ($1::uuid is null or s.duty_id = $1)
            order by s.suspended_at desc`,
    params: q => [q?.dutyId || null],
  },

  /**
   * The officials register: who is on the panel, and at what grade.
   *
   * The panel is official_panel() (db/107): a definer read that names its
   * columns — name, panel, standing, grade — to anybody enrolled, which is
   * the same disclosure the scorecard already makes. The table itself is
   * closed (db/107, REACH-D5): only the union that keeps the register reads
   * a row of it, and an official his own. So the columns that make an
   * official a person rather than a name — date of birth, ID number,
   * contact — come from a LEFT JOIN to the raw table, and arrive as NULL for
   * everyone the table's policy does not let through. Row security is the
   * floor here, not this query's discipline.
   *
   * `level` and `lapsed` are DERIVED on every read rather than stored, for
   * the reason a batting average is: an accreditation is a span, and a grade
   * copied into a column is a grade that keeps claiming to be current after
   * it has run out. official_level() returns NULL once every accreditation
   * has lapsed, which reads differently from never having held one — so the
   * two are reported separately and the screen can say which.
   */
  official_register: {
    text: `select o.id, o.full_name, o.panel, o.active,
                  r.born, r.id_number, r.email, r.phone,
                  o.level, o.accredited_until, o.accreditations
             from official_panel() o
             left join official r on r.id = o.id
            order by o.full_name, o.id`,
  },

  // The state of the square, scoped through the fixture exactly as weather is.
  // Nothing personal here, but a pitch-report table readable by anyone would
  // answer "does this school have a fixture on Saturday?" to whoever asked.
  /**
   * The match-day duty roster. SCRBRD-037.
   *
   * Officials, transport, the ground report, the team sheet and the scoring
   * session all exist and each is read on its own screen. Nobody has ever been
   * able to stand at a fixture and ask the one question that matters an hour
   * before the toss: IS EVERYTHING COVERED.
   *
   * READINESS, NOT NAMES. That is the whole point and it is the part that is
   * easy to get wrong. A duty with nothing recorded is `none` — it is NOT
   * "pending", because pending means somebody is expected and this schema does
   * not know that. No fixture declares how many umpires it ought to have, so a
   * roster that printed "Umpire 2 — pending" would be inventing an obligation
   * to fill it. `none` says what is true: nothing is on record.
   *
   * A UNION RATHER THAN A JOIN, deliberately. Each arm reads its own table
   * under that table's own row-level security, so the roster degrades per
   * reader without a line of code here: a coach who cannot see the transport
   * plan gets no transport row rather than an error or, worse, a row that
   * quietly claims nothing is arranged. What is missing from a reader's
   * roster is what is missing from that reader's authority, and the two should
   * be the same thing.
   *
   * `status` is an appointment's LIFECYCLE (SCRBRD-034): pending, active,
   * delegated, completed, expired — derived by duty_status() (db/30) from
   * the fixture's status, the appointment, and the scoring audit, never
   * stored. It is NULL on every other arm: a bus or a pitch report is not a
   * duty somebody holds. It grants nothing and is read here only so the
   * roster can say it; a withdrawn appointment ('revoked') is not on this
   * roster at all, for the reason above.
   *
   * `held` is WHOSE the scoring token is, for the reader (GA-I13, the
   * scorer's home): 'this_device' when the reader holds it on the device his
   * token was signed to, 'you' on another of his devices, 'another' for any
   * other holder, 'lapsed' when the session is active and no lease is current
   * (the pad's claim takes it, db/33). NULL while idle and on every other arm.
   * Worked out here, against app_user_id() and app_device_id(), so a client
   * never compares names or device ids; it says nothing the row did not
   * already say to a reader who may read the session (session_read, db/02).
   */
  match_duties: {
    text: `select o.duty                              as duty,
                  o.person_name                        as who,
                  'named'                              as state,
                  coalesce(o.panel, '')                as detail,
                  o.appointed_at                       as at,
                  duty_status(o.id)                    as status,
                  null::text                           as held
             from match_official o
            where o.match_id = $1 and not o.withdrawn
            union all
           select 'scoring', coalesce(u.name, ''),
                  s.state::text,
                  case when s.lease_until is not null then 'lease held' else '' end,
                  s.updated_at, null::text,
                  case when s.state = 'idle' then null
                       when s.state = 'active' and (s.lease_until is null or s.lease_until <= now()) then 'lapsed'
                       when s.holder_user_id = app_user_id() and s.holder_device = app_device_id() then 'this_device'
                       when s.holder_user_id = app_user_id() then 'you'
                       else 'another' end
             from scoring_session s
             left join app_user u on u.id = s.holder_user_id
            where s.match_id = $1
            union all
           select 'transport', coalesce(t.driver_name, ''), t.state, coalesce(t.registration, ''), t.arranged_at, null::text, null::text
             from (select tr.match_id, tr.arranged_at, v.registration, du.name as driver_name,
                          case when tr.cancelled_at is not null then 'cancelled'
                               when tr.arrived_at   is not null then 'arrived'
                               when tr.departed_at  is not null then 'departed'
                               else 'arranged' end as state
                     from trip tr
                     left join vehicle v  on v.id  = tr.vehicle_id
                     left join app_user du on du.id = tr.driver_id) t
            where t.match_id = $1
            union all
           select 'ground', '', 'recorded', coalesce(r.surface, ''), r.reported_at, null::text, null::text
             from match_pitch_report r
            where r.match_id = $1
            union all
           select 'squad', '', 'named', count(*)::text || ' selected', max(q.selected_at), null::text, null::text
             from match_squad q
            where q.match_id = $1 and not q.withdrawn
            having count(*) > 0`,
    params: q => [req(q, "matchId")],
  },

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
                  (sa_today() between sm.starts_on and sm.ends_on) as is_running
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
                  next_service_on, active, notes, school_id,
                  insurance_expires_on, roadworthy_expires_on,
                  -- One word a screen can act on, derived here rather than in
                  -- six components. 'unknown' is a gap in the records and is
                  -- not the same as 'current'; a coordinator's list should show
                  -- the gap, not paper over it.
                  case when insurance_expires_on is null or roadworthy_expires_on is null then 'unknown'
                       when least(insurance_expires_on, roadworthy_expires_on) < sa_today() then 'expired'
                       when least(insurance_expires_on, roadworthy_expires_on) < sa_today() + 30 then 'expiring'
                       else 'current' end as cover_state
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
  /*
   * AN ANSWER ABOUT A FIXTURE THAT HAS SINCE MOVED IS NOT AN ANSWER
   * (SCRBRD-122, db/65). `status` is the EFFECTIVE status from
   * availability_effective(): null (nobody answered), 'needs_reconfirming'
   * (an answer whose fixture's time, ground, format or overs changed since),
   * or the status as given. A client that knows nothing of the new word
   * still never reads a stale "available" as a yes. `said_status` is the
   * answer as given; `was_line` says what it was about ("was available for
   * Sat 3 Oct 09:00 at Gordon Sherwood Oval · T20, 20 overs"), only while
   * it is asking again. Boys asked again sort straight after the silent
   * ones: both are the ones to chase.
   */
  availability: {
    text: `select p.id                as player_id,
                  p.full_name,
                  p.team_code,
                  e.status,
                  a.status             as said_status,
                  e.moved              as needs_reconfirming,
                  (case when e.moved
                        then 'was ' || a.status || ' for '
                             || availability_fixture_words(a.fixture_starts_at, a.fixture_ground_id,
                                                           a.fixture_format, a.fixture_overs)
                   end)                as was_line,
                  -- The fixture as it stands, in the same words, so a screen
                  -- sets "now" beside "was" on one clock.
                  availability_fixture_words(m.starts_at, m.ground_id, m.format, m.overs) as fixture_words,
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
                  --
                  -- And null for a reader without medical.status.read for
                  -- this boy. injury_masked gives him no rows (injury_read,
                  -- db/09), so exists() alone answered false — "cleared" —
                  -- to a reader with no right to know either way (K3,
                  -- db/55). Asked per row with the same app_can() call
                  -- injury_read makes, as the readiness read below does.
                  (case when my_feature_enabled('injuries')
                         and app_can('medical.status.read', p.school_id, p.team_code, p.id,
                                     '00000000-0000-0000-0000-000000000000'::uuid)
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
             cross join lateral (select availability_effective(a, m)     as status,
                                        availability_fixture_moved(a, m) as moved) e
            where m.id = $1
            order by (a.status is null) desc, e.moved desc, p.full_name`,
    params: q => [req(q, "matchId")],
  },

  /**
   * THE ANSWERS THAT WERE REPLACED (SCRBRD-122, db/65). Nothing is deleted:
   * a re-declaration keeps the answer it replaces in
   * match_availability_history, read exactly as the live answer is — a
   * guardian his own child's, the people picking the side their side's.
   * `was_stale` says the fixture had moved from under it by then.
   */
  availability_history: {
    text: `select h.player_id, p.full_name, h.status, h.reason_kind, h.note,
                  h.declared_at, d.name as declared_by_name, coalesce(d.is_self, false) as self_declared,
                  availability_fixture_words(h.fixture_starts_at, h.fixture_ground_id,
                                             h.fixture_format, h.fixture_overs) as fixture_words,
                  h.superseded_at, h.was_stale
             from match_availability_history h
             join player p on p.id = h.player_id
             left join lateral availability_declarant(h.player_id, h.declared_by) d on true
            where h.match_id = $1
              and ($2::uuid is null or h.player_id = $2)
            order by p.full_name, h.superseded_at desc`,
    params: q => [req(q, "matchId"), q?.playerId || null],
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
   * told us nothing, and the nothing is what needs chasing. An answer whose
   * fixture has moved since (SCRBRD-122) is 'needs_reconfirming' and ranks
   * with silence, conflict included: it told us nothing about this fixture.
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

  /**
   * WHO TO RING FOR ONE CHILD, in order.
   *
   * Live rows only: a retired number is history, and a coach with a phone in
   * one hand does not need it. Governed by player.emergency.read, which the
   * people around the child on a Saturday hold and the office's file
   * capability does not imply — see the note on the table in db/08.
   */
  emergency_contacts: {
    text: `select c.id, c.player_id, p.full_name, c.school_id, c.priority,
                  c.name, c.relationship, c.phone, c.phone_alt, c.email, c.note,
                  c.created_at
             from emergency_contact c
             join player p on p.id = c.player_id
            where c.player_id = $1 and c.active
            order by c.priority`,
    params: q => [req(q, "playerId")],
  },

  /**
   * HOW MANY NUMBERS ARE ON RECORD TO RING FOR ONE CHILD, and nothing else
   * (GA-I20 A1, N2; docs/design/GA-I20_parent_action_list.md §5.2, D8).
   *
   * The parent's action list asks "is anybody on record to ring if he is
   * hurt?" every time her Home opens. Reading `emergency_contacts` for that
   * would hand the screen the phone numbers and log a disclosure she never
   * asked for, so this returns the child's id and a count: no name, no phone,
   * no email, no relationship. It is NOT in RESTRICTED_FIELDS, because
   * nothing it returns is a contact.
   *
   * A row comes back only where the caller may read the child's contacts:
   * the player row under its own RLS, AND the same app_can() question
   * emergency_contact's own SELECT policy asks (db/09, player.emergency.read
   * for this boy). So a parent of another family, a pupil (selfaccess holds
   * no player.emergency.read, STEP4 Q7) or a coach without the capability
   * gets no row, never a false zero. The count itself is read under
   * emergency_contact's own policy, live rows only, as the list is.
   */
  emergency_contact_count: {
    text: `select p.id as player_id, p.school_id,
                  (select count(*) from emergency_contact c
                    where c.player_id = p.id and c.active)::int as active_count
             from player p
            where p.id = $1
              and app_can('player.emergency.read', p.school_id, p.team_code, p.id,
                          '00000000-0000-0000-0000-000000000000'::uuid)`,
    params: q => [req(q, "playerId")],
  },

  /**
   * THE MANIFEST: every child on a trip and who to ring for each.
   *
   * Through trip_contacts() in db/08, which is where the decision lives — the
   * driver reaches it through transport.drive on the fixture inside a window
   * around departure, everyone else per child through player.emergency.read.
   * Nothing here is filtered a second time; if a row comes back, the function
   * decided this person may have it.
   */
  trip_contacts: {
    text: `select player_id, full_name, priority, name, relationship,
                  phone, phone_alt, email, note, school_id
             from trip_contacts($1::uuid)`,
    params: q => [req(q, "tripId")],
  },

  /*
   * THE CLEARANCE REGISTER: every adult with a live appointment at the school
   * whose role requires a check, against every check it requires, with one
   * word each. Through clearance_register() in db/08, which is where the
   * decision lives — clearance.read at the school or nothing. The gaps are
   * the point and come first.
   */
  clearance_register: {
    text: `select person_id, name, role, kind, clearance_kind_label(kind) as kind_label,
                  status, expires_on, clearance_id, reference, school_id
             -- No school named means the reader's own: the screen has no other
             -- school to ask about, and the function refuses any it may not read.
             from clearance_register(coalesce($1::uuid, (select school_id from app_user where id = app_user_id())))
            order by case status when 'missing' then 0 when 'expired' then 1 when 'revoked' then 2
                                 when 'expiring' then 3 else 4 end, name, kind`,
    params: q => [q?.schoolId || null],
  },

  /*
   * ONE ADULT'S CLEARANCES at whatever schools the reader may see them for:
   * the office through clearance.read, the person through the identity
   * policy. History included — a revoked row stays, with its reason — because
   * "what did we hold on him in March" is the question an enquiry asks.
   */
  clearances: {
    text: `select c.id, c.person_id, u.name, c.school_id, c.kind, clearance_kind_label(c.kind) as kind_label,
                  c.reference, c.issued_on, c.expires_on, c.note,
                  c.verified_by, v.name as verified_by_name, c.verified_at,
                  c.revoked_at, c.revoked_reason,
                  case when c.revoked_at is not null then 'revoked'
                       when c.expires_on < sa_today() then 'expired'
                       when c.expires_on <= sa_today() + 60 then 'expiring'
                       else 'current' end as status
             from adult_clearance c
             join app_user u on u.id = c.person_id
             left join app_user v on v.id = c.verified_by
            where c.person_id = $1
            order by c.kind, c.expires_on desc, c.verified_at desc`,
    params: q => [req(q, "personId")],
  },

  /* The reader's own, for their settings screen. The policy is the identity one. */
  my_clearances: {
    text: `select c.id, c.school_id, s.name as school_name, c.kind, clearance_kind_label(c.kind) as kind_label,
                  c.issued_on, c.expires_on, c.revoked_at,
                  case when c.revoked_at is not null then 'revoked'
                       when c.expires_on < sa_today() then 'expired'
                       when c.expires_on <= sa_today() + 60 then 'expiring'
                       else 'current' end as status
             from adult_clearance c
             join school s on s.id = c.school_id
            where c.person_id = app_user_id()
            order by c.school_id, c.kind, c.expires_on desc`,
  },

  /*
   * WORKLOAD: what each boy bowled and trained, with the server's word for
   * where his load sits. Through workload() (db/60's, re-emitting db/08's),
   * per boy under player.workload.read: the function asks app_can() for each
   * boy before he is in, as bowling_breaches' policy and bowling_spells' join
   * do. An optional team narrows; nothing widens. Level 2: not logged for a
   * school's own staff (SCRBRD-110 §2.3); a platform-wide or support reader's
   * answer is, as every read's is.
   */
  workload: {
    // THE CLAUSE BESIDE THE LIMIT (SCRBRD-041). The limit a boy is under is
    // bowling_directive's for his band, and that row names the rulebook
    // clause it enforces (db/32) — so the monitor can cite the rule instead
    // of asserting a bare number. Only for a pace bowler: a spinner is under
    // no limit, and the U13 clause beside a leg-spinner's name would be the
    // screen claiming a rule applies that does not. For an Open bowler whose
    // school has set its own ceiling the clause is PACE-OPEN, which is the
    // one that says the school's ceiling is the limit.
    //
    // LATERAL, so the function scan stays the outer side of a nested loop
    // and workload()'s own order (breaches first, then spikes) survives the
    // join, as it did when this read was `select * from workload()`.
    text: `select w.*, c.code as clause_code, c.title as clause_title,
                  c.severity as clause_severity, c.body as clause_body
             from workload($1::text) w
             left join lateral (
               select rc.code, rc.title, rc.severity, rc.body
                 from bowling_directive d
                 join rulebook_clause rc on rc.code = d.clause_code
                where d.age_band = w.age_band and w.pace) c on true`,
    params: q => [q?.teamCode || null],
  },

  /*
   * A BOY'S OVERS TODAY, ACROSS EVERY MATCH (SCRBRD-136/137 phase B §1.4,
   * db/94): overs_today and matches_today on one date (the fixture's SA start
   * date, as bowler_over dates an over), beside the directive's figures and
   * its clause. The coach's feed draws it as S2c, only while our side fields.
   * bowler_day() asks player.workload.read per boy, as workload() does, so a
   * reader without it for a boy gets no row for him: the team manager, a
   * scorer and a pupil get an empty answer, not an error naming the gate.
   * It returns no other match's id, opponent or venue ("two matches" is a
   * count) and nothing of the load model. Logged as workload is: not for a
   * school's own staff. An optional team narrows; nothing widens.
   */
  bowler_day: {
    text: `select * from bowler_day($1::date, $2::text)`,
    params: (q) => {
      const date = req(q, "date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
        const e = /** @type {DressedError} */ (new Error("bad_param:date")); e.status = 400; throw e;
      }
      return [date, q?.teamCode || null];
    },
  },

  /*
   * ONE BOWLER'S LOAD (SCRBRD-110 §2, db/60): the 7/14/28/42-day windows with
   * their "estimate" marks and the exact match share, the EWMA ratio and its
   * word, the uncoupled 7:21, the gaps, his own baseline, and whether his
   * health consent is live. One row, or none for a boy the reader may not read
   * the load of — load_summary() asks player.workload.read per boy, as
   * workload() does. Level 2, not logged (§2.3). Owned by the
   * workload_monitoring feature.
   */
  load: {
    text: `select * from load_summary($1::uuid, coalesce($2::text, 'cricket'))`,
    params: q => [req(q, "playerId"), q?.sport || null],
  },

  /* His weekly totals for the chart, oldest first, with the 13- and 26-week means. */
  load_weeks: {
    text: `select * from load_weeks($1::uuid, $2::int, coalesce($3::text, 'cricket'))`,
    params: q => [req(q, "playerId"), q?.weeks ? Number.parseInt(q.weeks, 10) || 26 : 26, q?.sport || null],
  },

  /*
   * THE FAMILY'S CONSENTS (SCRBRD-110 §7; STEP 4 §4.3). Health monitoring, per
   * child the caller answers for — her children as a guardian, himself through
   * his own account — as words and dates, naming nobody. my_health_consents()
   * finds the caller's own live links; it takes no id, so it cannot be asked
   * about somebody else's child. Not module-gated: a family's answer is
   * theirs to see and to withdraw whatever a school has switched on, and a
   * record already given stays and counts again if the school switches the
   * module back on (§9.1, Decided 2).
   *
   * `module_on` is the one addition (§9.1, Decided 2): whether
   * workload_monitoring is on for THAT CHILD'S school, read with the two
   * PUBLIC-granted functions the schema already has for exactly this shape —
   * player_school() (a caller may know a child's school without being able to
   * read the child) and feature_enabled(). It decides nothing here; the
   * screens use it to hide the toggle, the one-time card and the eighteen
   * card where the module is off, so no family is asked about something that
   * is not in use. No new capability, no new function, no new endpoint.
   */
  consents: {
    text: `select 'health' as kind, c.*,
                  feature_enabled('workload_monitoring', player_school(c.player_id), null) as module_on
             from my_health_consents() c`,
  },

  /*
   * ONE MATCH'S SPELLS, per bowler, from the log, with the directive that
   * applied to each boy beside it. The scorer's screen and the coach's both
   * read this; neither computes a spell of its own.
   *
   * The spells are the match's log and go to whoever may read it. The
   * directive beside them does not: its age band is derived from the boy's
   * date of birth, and its limits are a reading of his workload. So those
   * columns, and over_spell_limit, come back only to a reader holding
   * player.workload.read for that boy (his team, his school, or the boy
   * himself through self-access), asked per row with the same app_can() call
   * workload() and bowling_breach's policy make (SCRBRD-136/137 D15).
   * Everyone else — a scorer, a pupil, a spectator — gets the spell with
   * them null. The gate is the join's own condition, in SQL: an unauthorised
   * reader's row never holds the figures for JavaScript to forget to strip.
   * breach_recorded needs no gate of its own: bowling_breach's policy is the
   * same capability, so for that reader it is already false.
   */
  bowling_spells: {
    text: `select s.match_id, s.innings, s.bowler_id, p.full_name, s.spell_no, s.first_over, s.last_over,
                  s.overs, s.legal_balls, s.bowled_on,
                  d.age_band, d.pace, d.max_overs_per_spell, d.max_overs_per_day,
                  (case when w.may then d.max_overs_per_spell is not null
                                        and s.overs > d.max_overs_per_spell end) as over_spell_limit,
                  exists (select 1 from bowling_breach x
                           where x.match_id = s.match_id and x.innings = s.innings
                             and x.bowler_id = s.bowler_id and x.kind = 'spell' and x.key = s.first_over) as breach_recorded
             from bowler_spell s
             join player p on p.id = s.bowler_id
             cross join lateral (select app_can('player.workload.read', p.school_id, p.team_code, p.id,
                                                '00000000-0000-0000-0000-000000000000'::uuid) as may) w
             left join lateral bowling_directive_for(s.bowler_id) d on w.may
            where s.match_id = $1
            order by s.innings, s.bowler_id, s.spell_no`,
    params: q => [req(q, "matchId")],
  },

  /* Breaches on record, most recent first. Per row under player.workload.read (bowling_breach's policy, db/08). */
  bowling_breaches: {
    text: `select x.id, x.match_id, m.opponent, x.innings, x.bowler_id, p.full_name, p.team_code,
                  x.kind, x.overs, x.allowed, x.age_band, x.bowled_on, x.noticed_at
             from bowling_breach x
             join player p on p.id = x.bowler_id
             join match m on m.id = x.match_id
            where ($1::text is null or p.team_code = $1)
            order by x.bowled_on desc, x.noticed_at desc`,
    params: q => [q?.teamCode || null],
  },

  /* The directive itself, with the clause each band's limit enforces. Platform reference data. */
  bowling_directives: {
    text: `select age_band, max_overs_per_spell, max_overs_per_day, clause_code from bowling_directive
            order by ${BAND_ORDER("age_band")}`,
  },

  /*
   * THE RULEBOOK (SCRBRD-041): the platform's clauses, from db/32, each with
   * the age bands it applies to and — where a directive row cites it — the
   * figures it enforces, joined from bowling_directive rather than written
   * into the clause text, so the rule a person reads and the number the
   * breach trigger applies cannot disagree. Reference material: the policy
   * is "signed in", the same as the directive's.
   */
  rulebook_clauses: {
    text: `select c.code, c.title, c.body, c.category, c.severity, c.source,
                  coalesce((select array_agg(a.age_band order by ${BAND_ORDER("a.age_band")})
                              from rulebook_clause_age a where a.clause_code = c.code), '{}') as applicable_ages,
                  coalesce((select json_agg(json_build_object('age_band', d.age_band,
                                                              'max_overs_per_spell', d.max_overs_per_spell,
                                                              'max_overs_per_day', d.max_overs_per_day)
                                            order by ${BAND_ORDER("d.age_band")})
                              from bowling_directive d where d.clause_code = c.code), '[]') as limits
             from rulebook_clause c
            order by c.category, c.sort_order, c.code`,
  },

  /*
   * RECOGNITION: one boy's honours, caps and milestones in one shape, through
   * recognition() in db/08 — player.profile.read on him or nothing. Honours
   * are awarded, caps are earned, milestones happen; none is a score.
   */
  recognition: {
    text: `select family, kind, label, value, season, on_date, match_id, opponent, is_public, citation, ref_id
             from recognition($1::uuid)`,
    params: q => [req(q, "playerId")],
  },

  /* A side's caps ledger, in cap order. Derived from the team sheets. */
  caps: {
    text: `select c.school_id, c.team_code, c.player_id, c.full_name, c.cap_no, c.appearances,
                  c.first_on, c.last_on, c.first_match_id, c.baseline_set
             from team_cap c
            where c.team_code = $1
            order by c.cap_no`,
    params: q => [req(q, "teamCode")],
  },

  /* Live honours, newest first, optionally one side's or one season's. */
  honours: {
    text: `select h.id, h.player_id, p.full_name, h.school_id, h.team_code, h.kind, h.name,
                  honour_kind_label(h.kind, h.name) as label, s.label as season, h.citation, h.awarded_on,
                  h.is_public, u.name as awarded_by_name
             from honour h
             join player p on p.id = h.player_id
             join season s on s.id = h.season_id
             left join app_user u on u.id = h.awarded_by
            where h.withdrawn_at is null
              and ($1::text is null or h.team_code = $1)
              and ($2::text is null or s.label = $2)
            order by h.awarded_on desc, p.full_name`,
    params: q => [q?.teamCode || null, q?.season || null],
  },

  /* Milestones from the log, newest first. Per row, the player's own visibility. */
  milestones: {
    text: `select ms.player_id, p.full_name, p.team_code, ms.kind, milestone_label(ms.kind, ms.value) as label,
                  ms.value, ms.match_id, ms.innings, ms.opponent, ms.played_on
             from player_milestone ms
             join player p on p.id = ms.player_id
            where ($1::text is null or p.team_code = $1)
              and ($2::uuid is null or ms.player_id = $2)
            order by ms.played_on desc, p.full_name`,
    params: q => [q?.teamCode || null, q?.playerId || null],
  },

  /*
   * ROLE REQUESTS: mine, and the ones I could answer. `decidable` is the
   * server's word — the same two checks decide_role_request() makes — so a
   * screen draws a Grant button only where a grant would succeed.
   */
  role_requests: {
    text: `select r.id, r.person_id, u.name, u.email, r.role, r.school_id, s.name as school_name, r.team_code,
                  r.player_id, r.note, r.state, r.requested_at, r.decided_at, r.decided_note, d.name as decided_by_name,
                  -- Not asked by its person signed in as himself (db/84): POST /api/onboard.
                  r.asked_unverified,
                  r.person_id = app_user_id() as mine,
                  (r.state = 'pending'
                   and app_can('user.role.assign', r.school_id, '*', '00000000-0000-0000-0000-000000000000'::uuid,
                               '00000000-0000-0000-0000-000000000000'::uuid)
                   -- The role question at the request's school (db/77), as the grant asks it.
                   and app_may_grant_at(r.role, r.school_id)) as decidable
             from role_request r
             -- Who asked, through role_requester() (db/81): an account that
             -- signed up with Google has no school until its first grant, and
             -- the office's own RLS on app_user reads an account only at the
             -- office's school — a join here dropped exactly those requests.
             left join lateral (select q.name, q.email from role_requester(r.id) q) u on true
             -- The school's name from the public list: a stranger with no
             -- assignments may not read the school row and must still see
             -- which school his request is with.
             left join lateral (select ps.name from public_schools() ps where ps.id = r.school_id) s on true
             left join app_user d on d.id = r.decided_by
            order by case r.state when 'pending' then 0 else 1 end, r.requested_at desc`,
  },

  /**
   * THE WAYS I SIGN IN (SCRBRD-140, db/81): Google accounts linked to this
   * account, live and revoked — never the provider's uid. my_sign_ins() reads
   * the caller's own and nobody else's.
   */
  my_sign_ins: {
    text: `select id, provider, email_at_link, linked_at, linked_how, last_sign_in_at, revoked_at
             from my_sign_ins()`,
  },

  /**
   * THE OFFICE'S CLAIMS LIST (SCRBRD-140 §3.3): a Google sign-in whose
   * verified email matched an account the office enrolled, waiting for a
   * person to look — confirm (POST /api/auth/claims/:id/confirm), or issue a
   * code as today. pending_claims() returns only claims on accounts the
   * caller may issue a code to (user.invite at the account's school), the
   * account as enrolled beside the address Google verified, never the uid.
   */
  sign_in_claims: {
    text: `select id, user_id, account_name, account_email, account_active, school_id,
                  presented_email, provider, requested_at, last_requested_at
             from pending_claims()`,
  },

  /* The drill library: the platform's, and this reader's schools'. */
  drills: {
    text: `select d.id, d.school_id, d.name, d.category, d.duration_min, d.description, d.retired
             from drill d where not d.retired
            order by d.school_id nulls first, d.category, d.name`,
  },

  /* The kit, with how many are out. */
  equipment: {
    text: `select e.id, e.school_id, e.kind, e.label, e.quantity, e.condition, e.notes, e.updated_at,
                  (select count(*)::int from equipment_issue i where i.equipment_id = e.id and i.returned_on is null) as out
             from equipment e order by e.kind, e.label`,
  },

  /* Who has what. Open issues unless ?all=1. */
  equipment_issues: {
    text: `select i.id, i.equipment_id, e.label, e.kind, i.player_id, p.full_name, p.team_code, i.issued_on, i.returned_on
             from equipment_issue i
             join equipment e on e.id = i.equipment_id
             join player p on p.id = i.player_id
            where ($1::boolean or i.returned_on is null)
            order by i.returned_on nulls first, i.issued_on desc`,
    params: q => [q?.all === "1"],
  },

  /*
   * THE PASSPORT: a boy's cricket record with provenance and confidence on
   * every line, for his family, his own school, and a school the family has
   * named. The gate is passport() in db/08.
   */
  passport: {
    // passport() (db/08, frozen) labels its career and milestone lines "the
    // ball log". Since db/64 those lines also count innings imported from a
    // scorebook (SCRBRD-120), so the source is said as "the match record" for
    // every boy: true whichever mix he has, and it needs no second read of the
    // ball log that a guardian's own scope might not let the caller make.
    text: `select family, label, value, on_date, source_school,
                  case when recorded_by = 'the ball log' then 'the match record' else recorded_by end as recorded_by,
                  confidence
             from passport($1::uuid)`,
    params: q => [req(q, "playerId")],
    // A boy's record read across schools (a union, a named school): kept by
    // no browser (UNION_SELECTOR_FIND D7, S3).
    noStore: true,
  },
  /**
   * Whether a boy may be seen by accredited scouts, and who decided.
   *
   * SCRBRD-055. The table has gated scouting_candidates() since it was
   * written — an inner join on consent_state = 'granted', so a withdrawal and
   * a decision never made both fall out — and the family could set it through
   * /api/players/:id/scouting-consent. What was missing was any way to LOOK at
   * it. A consent the person who gave it cannot inspect is a consent in name,
   * which is the whole reason this read exists.
   *
   * No filtering here. The table's own policy (db/115, REACH R-B) is the
   * boy's family, the office at his school and his own side's coach
   * (player.development.read at his side), so a guardian sees their own
   * children, a pupil his own decision and no team-mate's, a coach his side's,
   * and a scout nothing.
   *
   * `in_force` (db/122, Kameel 29 Oct 2026: "The consent lapses when the link
   * that gave it ends"): a yes whose giver's link has since ended still reads
   * `granted`, as history, with in_force false; scouting_candidates() no
   * longer counts it.
   */
  scouting_consent: {
    text: `select c.player_id, p.full_name, p.team_code, c.consent_state, c.decided_at,
                  u.name as decided_by_name, scouting_consent_in_force(c.player_id) as in_force
             from player_scouting_consent c
             join player p on p.id = c.player_id
             left join app_user u on u.id = c.decided_by
            order by p.full_name`,
  },

  // The schools a family has named for a boy's record. Read by his family and
  // by the office of the school a row names (db/115, REACH R-B: "office
  // only"); the receiving coach reads the passport above, not these rows.
  // `in_force` (db/122): false for a withdrawn row and for one whose giver's
  // link has ended (lapsed: it no longer opens the passport).
  // `recipient_ok` (db/124 §6 Q4): false for a row naming what a family may
  // no longer name (a club, an academy, or a union that is no longer his),
  // so the screen says why it opens nothing, not that a link has ended.
  passport_consents: {
    text: `select c.id, c.player_id, passport_name(c.player_id) as full_name, c.to_school_id, s.name as to_school, c.granted_at, c.withdrawn_at,
                  passport_consent_in_force(c.id) as in_force,
                  passport_consent_recipient_ok(c.player_id, c.to_school_id) as recipient_ok
             from passport_consent c
             left join lateral (select ps.name from public_schools() ps where ps.id = c.to_school_id) s on true
            order by c.withdrawn_at nulls first, c.granted_at desc`,
  },
  // Who at a union looked at his passport, and when (db/124, Kameel 29 Oct
  // 2026: "Named selectors and the schools cricket manager only, every read
  // logged"), for every boy the caller is family of on a live link: his
  // guardians and the boy himself. Nobody else is answered; the definer
  // decides. The log itself is written by passport() and passport_name().
  passport_union_reads: {
    text: `select player_id, read_at, reader_name, reader_role, organisation, what
             from passport_union_reads()`,
  },
  // What his family may name for his record (db/124 §6 Q4, Kameel 30 Oct
  // 2026): every school, his own provincial union and CSA Schools; no club or
  // academy. The definer answers his family alone, by the insert policy's own
  // test, so the consent's picker offers nothing the server would refuse.
  passport_recipients: {
    text: `select id, name, kind from passport_recipients($1::uuid)`,
    params: q => [req(q, "playerId")],
  },
  // A union selector finds the boys whose families named his union
  // (docs/design/UNION_SELECTOR_FIND.md, db/125, Kameel 30 Oct 2026). The
  // definers decide everything: who reads as a union (passport_union_reader_at),
  // which boys (a consent in force to that institution, now), and the record
  // (every row returned is a 'list' read his family sees, and one access_log
  // row per school). Nothing is kept: no-store on all three, and the list is
  // never a file (packages/policy/src/exports.mjs).
  //   passport_union_orgs     the institutions at which the caller reads
  //   passport_union_schools  ?org= the schools he may filter by
  //   passport_union_list     ?org=&school=&ageGroup=&q= the boys; a school or
  //                           an age group first (choose_a_school_or_age_group)
  passport_union_orgs: {
    text: `select org_id, name, kind from passport_union_orgs()`,
    noStore: true,
  },
  passport_union_schools: {
    text: `select school_id, name from passport_union_schools($1::uuid)`,
    params: q => [uuidParam(q, "org", true)],
    noStore: true,
  },
  passport_union_list: {
    text: `select player_id, name, school_name, team_code, org_id, consent_id
             from passport_union_list($1::uuid, $2::uuid, $3::text, $4::text)`,
    params: q => [uuidParam(q, "org"), uuidParam(q, "school"), q?.ageGroup || null, q?.q || null],
    logsItself: true,
    noStore: true,
    refuses: ["choose_a_school_or_age_group"],
  },
  // His name, as the passport's own door answers it (UNION_SELECTOR_FIND D6:
  // the open from a row calls passport() and passport_name()). Null when the
  // door is shut, which is how the selector's screen tells "no longer open to
  // your union" from a record with no line on it yet; a union reader's call is
  // logged by the definer as a 'name' read his family sees.
  passport_name: {
    text: `select passport_name($1::uuid) as name`,
    params: q => [uuidParam(q, "playerId", true)],
    noStore: true,
  },

  /* Which roles must hold which checks. Platform reference data. */
  clearance_requirements: {
    text: `select role, kind, clearance_kind_label(kind) as kind_label
             from clearance_requirement order by role, kind`,
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
                  -- EFFECTIVE, as the availability read gives it (SCRBRD-122,
                  -- db/65): an answer about a fixture that has since moved is
                  -- 'needs_reconfirming', never its old status.
                  e.status                    as declared_status,
                  a.status                    as said_status,
                  e.moved                     as needs_reconfirming,
                  a.reason_kind,
                  coalesce(d.is_self, false)  as self_declared,
                  d.name                      as declared_by_name,
                  -- THE PHYSIO'S HALF. True is restricted, false is clear —
                  -- no restricted injury row — and null is "not this reader's
                  -- to know": either the Injuries module is off, so no
                  -- clinical opinion is being collected at all, or the reader
                  -- does not hold medical.status.read for THIS boy.
                  --
                  -- The coalesce is what tells "cleared" from "not asked": a
                  -- boy with no injury history left-joins to null. But a
                  -- reader without the status tier sees no injury rows at all
                  -- (injury_read, db/09), so for him every boy left-joins to
                  -- null, and the coalesce turned that into "cleared" for a
                  -- scorer, an official or a team-mate who has no right to
                  -- know either way (K3, db/55). So the coalesce applies only
                  -- where the reader's tier is what fills the column, asked
                  -- per row with the SAME app_can() call injury_read makes —
                  -- which is also why, for any other reader, c is empty and
                  -- rtw_date, state and conflict carry nothing clinical.
                  (case when my_feature_enabled('injuries') and k.may
                        then coalesce(c.restricted, false)
                   end)                        as clinically_restricted,
                  c.rtw_date,
                  -- THE COACH'S HALF. A withdrawn selection is not a selection
                  -- (every read of a squad has to say so), so it comes back
                  -- unpicked here.
                  (s.player_id is not null)   as selected,
                  s.side                      as selected_side,
                  s.batting_no,
                  -- An answer asking again ranks with silence: whatever it
                  -- said, it said it about another fixture.
                  case when c.restricted                   then 'restricted'
                       when e.status = 'unavailable'        then 'unavailable'
                       when e.status is null                then 'unanswered'
                       when e.status = 'needs_reconfirming' then 'needs_reconfirming'
                       when e.status = 'doubtful'           then 'doubtful'
                       else                                      'available'
                  end                         as state,
                  -- The row a selector needs to see first: somebody is in the
                  -- side who should not be. Derived from two columns of this
                  -- same row, so a client computing it could not get it wrong
                  -- — it is here because doing the join is the whole point of
                  -- the read, and leaving the conclusion to the caller would
                  -- put us back to flicking between screens.
                  case when s.player_id is null then null
                       when c.restricted             then 'selected_while_restricted'
                       when e.status = 'unavailable' then 'selected_while_unavailable'
                       when e.status is null or e.moved then 'selected_without_answer'
                  end                         as conflict
             from match m
             join player p
               on p.school_id = m.school_id
              and p.team_code = m.team_code
             left join match_availability a
               on a.match_id = m.id and a.player_id = p.id
             left join lateral availability_declarant(p.id, a.declared_by) d on true
             left join clinical c on c.player_id = p.id
             cross join lateral (select app_can('medical.status.read', p.school_id, p.team_code, p.id,
                                                '00000000-0000-0000-0000-000000000000'::uuid) as may) k
             left join match_squad s
               on s.match_id = m.id and s.player_id = p.id and not s.withdrawn
             cross join lateral (select availability_effective(a, m)     as status,
                                        availability_fixture_moved(a, m) as moved) e
            where m.id = $1
            -- Conflicts first, then the worst news, then alphabetically.
            order by (case when s.player_id is not null
                            and (c.restricted or e.status is distinct from 'available')
                           then 0 else 1 end),
                     (case when c.restricted            then 0
                           when e.status = 'unavailable' then 1
                           when e.status is null or e.moved then 2
                           when e.status = 'doubtful'    then 3
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
   * MY ALERT SWITCHES (NOTIFICATIONS D20, D21; db/120). The kinds this
   * person receives that they may stop being pushed, each with its state,
   * a parent's per child; and whether a pupil's quiet hours apply to them.
   * my_alert_choices() answers for the caller alone: there is no version of
   * this read for anybody else, as there is none of my_devices.
   *
   * Push only. Nothing else in this file reads a preference: Notices, the
   * badge and the summary are my_notifications, whatever is switched off
   * here (push-decision.test.mjs holds that).
   */
  //
  // ALWAYS ONE ROW AT LEAST. Quiet hours are the caller's whether or not any
  // switch is offered, so the read starts from my_push_quiet_hours() and
  // joins the switches to it: a pupil with nothing to switch off still reads
  // one row, its kind null, saying his hours. Under a pad's credential both
  // answer nothing (the route refuses first).
  my_notification_prefs: {
    text: `select c.kind, c.subject_player_id, c.player_name, c.push, q.quiet_hours
             from (select my_push_quiet_hours() as quiet_hours) q
             left join my_alert_choices() c on true`,
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
   * The switches are readable by anyone signed in, like feature_flag itself:
   * what the product offers and whether a school has it is not a secret from
   * that school. WHO a module was hidden from is. A row naming a person says
   * a school administrator decided something about him, often for a reason
   * that must not travel (db/102), so the named rows are read only by a
   * holder of school.feature.manage at that school and by the person named.
   * `people_hidden` is therefore the managers' number: to anybody else it is
   * null, not the count of the rows row security happens to show them (his
   * own, or none), which would read as "hidden from nobody".
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
                  case when app_can('school.feature.manage', $1::uuid, null, null, null)
                       then (select count(*)::int from feature_suppression s
                              where s.key = f.key and s.school_id = $1
                                and s.person_id is not null
                                and s.lifted_at is null)
                  end                                          as people_hidden,
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
   *
   * Row security decides who reads a named row (db/102): the school's
   * managers, and the person named, who reads that the module is hidden from
   * him but not why. The reason is not a column the application may select;
   * feature_suppression_reason() hands it to whoever may read it, and gives
   * the named person null.
   */
  module_suppressions: {
    text: `select s.key, s.school_id, s.person_id, u.name as person_name,
                  feature_suppression_reason(s.id) as reason, s.hidden_at
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
   * The wicket rule is NOT restated here. A wicket that stood
   * (ball_wicket_stands(), db/42 and db/87: a W, or one on a wide or a
   * no-ball, that the free hit did not save) with a dismissal that is the
   * bowler's is exactly the predicate
   * player_bowling_career uses, and two definitions of "wicket" that can drift
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
                  -- The balls of the over: not a wide or a no-ball, nor a
                  -- delivery that does not count (Law 17.3.2.5; db/54's
                  -- ball_counts_in_over(), countsInOver() in packages/scoring).
                  count(*) filter (where ball_counts_in_over(b.ball_type, b.payload))::int  as balls,
                  -- Runs off the bat. Byes and leg byes are not the batter's,
                  -- which is the same split runs_conceded makes on the bowling
                  -- side of the same delivery — nor are byes or leg byes off a
                  -- no-ball, which it records in payload.nbRuns (SCRBRD-068;
                  -- runsOffBat() in packages/scoring is the same rule).
                  coalesce(sum(case when ${OFF_THE_BAT_SQL}
                                    then coalesce(b.value,0) else 0 end), 0)::int as runs,
                  -- A dot is a legal delivery worth nothing, which is the rule
                  -- derivePhases already applies (packages/scoring/src/phases.mjs).
                  -- Not "the batter scored nothing": two byes are a legal ball
                  -- he did not score off, and counting it as a dot here would
                  -- give a phase breakdown and a matchup two different dot
                  -- counts for the same over. One definition, or neither means
                  -- anything.
                  count(*) filter (where ball_counts_in_over(b.ball_type, b.payload)
                                     and coalesce(b.value,0) = 0)::int          as dots,
                  -- The batter's fours and sixes, as the fold and the phases
                  -- count them: off the bat. Counting every ball worth four
                  -- called four byes, and five wides, a boundary.
                  count(*) filter (where b.value = 4 and b.ball_type <> 'W' and ${OFF_THE_BAT_SQL} and ${BOUNDARY_SQL})::int as fours,
                  count(*) filter (where b.value = 6 and b.ball_type <> 'W' and ${OFF_THE_BAT_SQL} and ${BOUNDARY_SQL})::int as sixes,
                  -- A dismissal the free hit saved is not one: the fold's
                  -- rule, ball_wicket_stands() in db/42, which is what every
                  -- SQL wicket count asks. A wicket with no method is not the
                  -- bowler's (chargedToBowler(null) is false), and who is
                  -- out is the fold's \`dismissed ?? striker\`,
                  -- ball_dismissed_batter() in db/43: a typed-name batter run
                  -- out at the far end is not the striker's dismissal. A
                  -- wicket is a W, or one on a wide or a no-ball (db/87):
                  -- ball_wicket_stands() answers false for anything else.
                  count(*) filter (
                    where b.dismissal is not null
                      and b.dismissal not in (${NOT_THE_BOWLERS})
                      and ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) = b.striker_id
                      and ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                  )::int                                                       as dismissals
             -- The career log (db/71): a super over is no matchup's evidence.
             from ball_event_career b
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
             from ball_event_career
            where kind = 'ball'
              -- A named batter is one whose record the reader may read, as
              -- matchups' join on player asks (away visibility §4.2, db/97).
              and ($1::uuid is null or (striker_id = $1 and exists (select 1 from player p where p.id = $1)))`,
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
               -- The match's own innings (db/71): a super over decides who
               -- goes through, never the match's runs (SCRBRD-114 D7).
               (select ls.runs from match_live_score ls
                 where ls.match_id = m.id and ls.super_over is null order by ls.innings asc  limit 1) as first_runs,
               (select ls.runs from match_live_score ls
                 where ls.match_id = m.id and ls.super_over is null order by ls.innings desc limit 1) as second_runs,
               (select count(*) from match_live_score ls where ls.match_id = m.id and ls.super_over is null) as innings_played
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
                  ${UNRECORDED_ZERO("bat", "balls_faced")}
                  ${UNRECORDED_ZERO("bat", "fours")}
                  ${UNRECORDED_ZERO("bat", "sixes")}
                  coalesce(d.dismissals, 0)              as dismissals,
                  coalesce(bowl.matches, 0)              as bowl_matches,
                  coalesce(bowl.runs_conceded, 0)        as runs_conceded,
                  coalesce(bowl.legal_balls, 0)          as balls_bowled,
                  ${UNRECORDED_ZERO("bowl", "wides")}
                  ${UNRECORDED_ZERO("bowl", "no_balls")}
                  coalesce(bowl.wickets, 0)              as wickets,
                  ${UNRECORDED_COLUMNS}
                  coalesce(f.form, '{}')                 as form
             from player p
             left join player_batting_career bat on bat.player_id = p.id
             left join player_dismissals      d   on d.player_id  = p.id
             left join player_bowling_career  bowl on bowl.player_id = p.id
             left join (select z.player_id,
                               sum(z.innings_without_balls)      as innings_without_balls,
                               sum(z.runs_without_balls)         as runs_without_balls,
                               sum(z.innings_without_boundaries) as innings_without_boundaries,
                               sum(z.bowling_without_extras)     as bowling_without_extras
                          from player_unrecorded_figures z group by z.player_id) unrec
                    on unrec.player_id = p.id
             left join (select b.player_id, count(*) as batting_innings
                          from summary_batting_line b where b.player_id is not null
                         group by b.player_id) book
                    on book.player_id = p.id
             -- The form guide: the last eight innings, most recent first.
             -- Folded to one row per player BEFORE the join, because it is a
             -- different grain — one row per innings — and joining it raw
             -- would multiply the career totals above by the innings played.
             -- One pass over player_innings for every player (db/49), not a
             -- LATERAL per player: that was a scan of the ball log per player,
             -- quadratic in a school's size. A tie in ended_at is broken by
             -- match and innings, so the same log always reads the same.
             left join (
               select r.player_id,
                      array_agg(r.runs order by r.ended_at desc, r.match_id desc, r.innings desc) as form
                 from (select i.player_id, i.runs, i.ended_at, i.match_id, i.innings,
                              row_number() over (partition by i.player_id
                                                 order by i.ended_at desc, i.match_id desc, i.innings desc) as n
                         from player_innings i) r
                where r.n <= 8
                group by r.player_id
             ) f on f.player_id = p.id
            order by p.full_name`,
  },

  /**
   * The same career figures, season by season (SCRBRD-086).
   *
   * One row per player per school season in which he has a figure, `season`
   * being the label of the season his MATCHES are in — school_season_of()
   * on each match's start, the rule the `matches` read files the fixture by
   * (db/44). `?season=2026` narrows the rows to that one season; without it
   * every season comes back, which is also how a screen learns which seasons
   * have anything in them. `current_season` says which row's season is the
   * one today is in, from the same rule, so no client works it out from a
   * clock.
   *
   * A RESOURCE OF ITS OWN, NOT A PARAMETER ON `career`, for three reasons.
   *   - `career` stays what it was, row for row (db/49 made it one pass over
   *     the log, and proves the answer did not move). Stats-Magic, the squad,
   *     profile, analytics and competition screens, and the walks that prove
   *     it against the fold (smoke-browser-pad-laws, smoke-dismissals,
   *     smoke-summary) keep the exact query they were proven against, and
   *     "All seasons" on the Awards tab IS that read — not a new computation
   *     that would itself need proving equal.
   *   - It is a different grain. `career` is a row per player; this is a row
   *     per player per season. A parameter that changed a resource's shape
   *     would give one name two answers, and the CSV export reads a resource's
   *     columns off its single SELECT list.
   *   - A read is one statement. `career` with an optional season would be
   *     two computations behind one text, one of them always wasted.
   *
   * THE SAME SCOPE AS `career`, AND NOTHING NEW TO DECIDE. The three views are
   * security_invoker over ball_event_live, match and player (db/44), so the
   * figures cover exactly the deliveries this reader may see, and a player
   * appears only when this reader may read the player — the lifetime views'
   * rule, row for row. No module owns it, as none owns `career`. For every
   * player and every reader, the rows summed over seasons equal `career`
   * (db/99 §21, and the Awards walk checks it through this route).
   *
   * No form guide: a season's is not what the Awards tab ranks on, and
   * player_innings is not this file's to re-slice.
   */
  career_by_season: {
    text: `select p.id                                   as player_id,
                  p.full_name, p.team_code, p.school_id,
                  season,
                  season = (select school_season_of(now())) as current_season,
                  coalesce(bat.matches, 0)               as bat_matches,
                  coalesce(bat.runs, 0)                  as runs,
                  ${UNRECORDED_ZERO("bat", "balls_faced")}
                  ${UNRECORDED_ZERO("bat", "fours")}
                  ${UNRECORDED_ZERO("bat", "sixes")}
                  coalesce(dis.dismissals, 0)            as dismissals,
                  coalesce(bowl.matches, 0)              as bowl_matches,
                  coalesce(bowl.runs_conceded, 0)        as runs_conceded,
                  coalesce(bowl.legal_balls, 0)          as balls_bowled,
                  ${UNRECORDED_ZERO("bowl", "wides")}
                  ${UNRECORDED_ZERO("bowl", "no_balls")}
                  ${UNRECORDED_COLUMNS}
                  coalesce(bowl.wickets, 0)              as wickets
             from (select * from player_batting_by_season    where $1::text is null or season = $1) bat
             -- USING merges the keys, so a player who only bowled in a season
             -- still has one row for it, and each view is computed once.
             full join (select * from player_dismissals_by_season where $1::text is null or season = $1) dis
               using (player_id, season)
             full join (select * from player_bowling_by_season    where $1::text is null or season = $1) bowl
               using (player_id, season)
             join player p on p.id = player_id
             -- Aliased apart from the merged key: a second bare season would
             -- be ambiguous in the ON clause and in the select list above.
             left join (select z.player_id as unrec_player, z.season as unrec_season,
                               z.innings_without_balls, z.runs_without_balls,
                               z.innings_without_boundaries, z.bowling_without_extras
                          from player_unrecorded_figures z) unrec
                    on unrec.unrec_player = p.id and unrec.unrec_season = season
             left join (select b.player_id as book_player, school_season_of(b.played_at) as book_season,
                               count(*) as batting_innings
                          from summary_batting_line b where b.player_id is not null
                         group by 1, 2) book
                    on book.book_player = p.id and book.book_season = season
            order by season desc, p.full_name`,
    params: q => [q?.season || null],
  },

  /**
   * How a boy is out, and how a bowler takes wickets — by method.
   *
   * `career` above has `dismissals` and `wickets` as single counts.
   * player_dismissal_breakdown / player_wicket_breakdown (db/26) are the same
   * scope, GROUPed one dimension further. Same tenant-scoping discipline as
   * `career`: no module owns this (see OWNER_OF_READ — `career` has none
   * either), because the actual gate is not a switch, it is the RLS this
   * already inherits from ball_event_live (security_invoker, fixture.read)
   * and from `player` (player.profile.read for the row that names them).
   * `player.performance.read` is a real capability — every scoring role holds
   * it — but nothing in this file or in db/09's policies asks app_can() about
   * it; it currently governs a client-side `holds()` check in
   * DashboardView.jsx and nothing on the read path. Inventing a second gate
   * here that the sibling resource does not have would make two people with
   * identical assignments see different things from `career` and from this,
   * for no reason either could discover. So this reuses exactly what `career`
   * already relies on rather than adding one.
   *
   * LONG-FORM: one row per player per dismissal type per side, `side` being
   * 'batting' or 'bowling' — the shape `skills` already uses for a small
   * fixed vocabulary. `dismissal` is NULL for a wicket whose method was never
   * recorded (see db/26); the client renders that as "method not recorded"
   * rather than dropping the row, so a sum over this resource never disagrees
   * with the flat total `career.dismissals` / `career.wickets` gives.
   *
   * CAUGHT AND BOWLED is not its own line — see db/26's comment. ball_event
   * has no fielder/catcher column, so there is nothing here to distinguish
   * the bowler catching his own wicket from any other fielder catching it off
   * him; both are 'caught'. Faking the split from bowler_id alone would be
   * wrong for nearly every 'caught' row.
   */
  dismissal_breakdown: {
    text: `select p.id as player_id, p.full_name, p.team_code, p.school_id,
                  'batting'::text as side, d.dismissal, d.dismissals as count
             from player p
             join player_dismissal_breakdown d on d.player_id = p.id
           union all
           select p.id as player_id, p.full_name, p.team_code, p.school_id,
                  'bowling'::text as side, w.dismissal, w.wickets as count
             from player p
             join player_wicket_breakdown w on w.player_id = p.id
            order by full_name, side, dismissal nulls last`,
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
  // SCRBRD-012. The sessions themselves. RLS: the person who began one, the
  // school it reached (audit.read), and the platform's support holders.
  // Liveness comes from support_access_live() — the ASSIGNMENT's hour hand,
  // the thing the decision functions read — rather than from a join: the
  // auditor at a school may not read the support person's assignment row,
  // and a join would silently drop the session they are entitled to see.
  // Reading the sessions is itself on the record (Kameel, 2026-10-02:
  // "transparency and accountability"): logsReads, below.
  support_access: {
    logsReads: () => [],
    text: `select s.id, s.actor_id, u.name as actor_name,
                  s.school_id, sc.name as school_name,
                  s.role, s.team_code, s.reason,
                  s.started_at, s.expires_at, s.ended_at, e.name as ended_by_name,
                  support_access_live(s.id) as live,
                  s.actor_id = app_user_id() as mine
             from support_access s
             left join app_user u  on u.id = s.actor_id
             left join school   sc on sc.id = s.school_id
             left join app_user e  on e.id = s.ended_by
            order by s.started_at desc`,
  },
  access_log: {
    text: `select l.id, l.school_id, l.person_id, u.name as person_name,
                  l.resource, l.record_ids, l.record_count, l.fields,
                  l.device_id, l.occurred_at,
                  -- Whether the reader reached this school from outside it.
                  l.platform_wide,
                  -- And whether they reached it through a support session
                  -- (db/22): the row in support_access says who, why and
                  -- for how long.
                  l.support_access_id,
                  l.person_id = app_user_id() as mine
             from access_log l
             left join app_user u on u.id = l.person_id
            where ($1::uuid is null or l.record_ids @> array[$1::uuid])
            order by l.occurred_at desc
            limit 500`,
    // Optional: everything read about ONE child, which is the question a
    // parent actually asks.
    params: q => [q?.playerId || null],
    // Reading the log is itself on the record, as audit_log() (db/79) is:
    // the raw log is no quieter a door than the tab (Kameel, 2026-10-02).
    // A read about one child names him.
    logsReads: q => (q?.playerId ? [q.playerId] : []),
  },

  // THE AUDIT LOG (SCRBRD-132 B2, db/79). audit_log() is the one door: it
  // reads each audit table under that table's own audit.read predicate,
  // never a safeguarding row and never free text, masks a child's name to
  // initials, and writes its own access_log row on every call — answered or
  // refused — so this read adds none (logsItself). Newest first, paged by
  // the last row's (at, key): ?before=&beforeKey=. ?schoolId defaults to
  // the reader's own school; ?kinds=access,role,...; ?since=, ?before= as
  // ISO instants; ?limit= 1..200 (50).
  audit_log: {
    text: `select l.at, l.kind, l.action, l.actor, l.subject_kind as "subjectKind", l.subject,
                  l.school_id, l.school, l.detail, l.key
             from audit_log($1::uuid, $2::text[], $3::timestamptz, $4::timestamptz, $5::text, $6::int) l`,
    params: (q) => auditLogParams(q),
    logsItself: true,
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

  /*
   * THE CHILDREN THIS CALLER ANSWERS FOR (step 4 G1, G11): one row per live
   * guardian link of HIS OWN, with the link's state and its end date, for the
   * family app's child switcher and its Family screen.
   *
   * SECURITY INVOKER, like every read here — it runs as the caller, under
   * RLS — and narrowed on top of that to the caller's own guardian
   * assignments. The narrowing is the point: assignment_subject's read
   * policy also lets the school office read every link at its school (it has
   * to, to work them), so without `a.person_id = app_user_id()` a registrar
   * opening the family app would be handed the school's families. A coach,
   * a spectator or another parent gets nothing; a parent who is also staff
   * gets her own children and nobody else's.
   *
   * A LIVE link only, by app_can()'s own clauses (db/23): verified, started,
   * not ended, through an active assignment. The player join is RLS-scoped
   * too, so a row comes back only where the caller may read the child.
   * valid_until is NULL while the child is at school (db/62) and the date
   * the link ends otherwise; the screen says which (§3.3). No self link, no
   * other guardian, no reason for anything: what is not hers is not here.
   *
   * consent_version and consent_at (GA-I20 A1, R8a): the wording of the
   * school's terms her own link was agreed under, and when it was recorded,
   * for "What you have agreed". Her own link's, never another guardian's.
   *
   * db/99 §49 runs this same text (between the my_children markers) as each
   * persona; read.test.mjs holds the two copies equal.
   */
  my_children: {
    text: /* my_children:begin */`select s.player_id, p.full_name, p.known_as, p.team_code,
                  p.school_id, sc.name as school_name, sc.kind as school_kind,
                  s.relationship, s.verification_state, s.consent_state,
                  s.consent_version, s.consent_at,
                  s.valid_from, s.valid_until
             from role_assignment a
             join assignment_subject s on s.assignment_id = a.id
             join player p on p.id = s.player_id
             left join school sc on sc.id = p.school_id
            where a.person_id = app_user_id()
              and a.role = 'guardian'
              and a.active
              and (a.valid_from  is null or a.valid_from  <= sa_today())
              and (a.valid_until is null or a.valid_until >  sa_today())
              and (a.expires_at  is null or a.expires_at  >  now())
              and s.verification_state = 'verified'
              and s.valid_from <= sa_today()
              and (s.valid_until is null or s.valid_until > sa_today())
            order by p.full_name, s.player_id`/* my_children:end */,
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
  /** @type {string[]} */
  const cols = [], joins = /** @type {string[]} */ ([]);
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
                          and s.withdrawn_at is null
                          and (s.category || '.' || s.metric) = any($${n}::text[])
                        order by s.category, s.metric, s.assessed_on desc) x
             ) ${d}_a on true
             left join lateral (
               select sum(dn.adjustment)::int as adjustment, count(*)::int as notes
                 from development_note dn
                where dn.player_id = p.id
                  and dn.about_discipline = '${d}'
                  and dn.adjustment is not null
                  and dn.withdrawn_at is null
                  and (${d}_a.anchor is null or dn.observed_on >= ${d}_a.anchor)
             ) ${d}_n on true`);
  });
  // THE EVIDENCE, IN ONE PASS OVER THE LOG (SCRBRD-097). This was one
  // player_batting_since(), player_dismissals_since() and
  // player_bowling_since() call per player, each its own scan of
  // ball_event_live, and none of their per-player predicates is leakproof —
  // so ball_event's policy, app_can('fixture.read', …), ran on every ball for
  // every player, three times over. It is now db/49's shape: the deliveries
  // this reader may see are read ONCE (`ev`, materialized, so the planner
  // cannot turn it back into a scan per player), each row is attributed to
  // the players it counts for, and the window is a predicate on the join to
  // that player's own anchors. The functions are untouched and are the
  // reference this is proved against (tools/bench-assessment.mjs --check).
  //
  // Row for row what the three functions sum:
  //   bat   player_batting_since(): runs off the bat and balls faced come only
  //         from a delivery he FACED (`kind = 'ball' AND striker_id = p` in
  //         every CASE). Its other two arms — a wicket at the other end, a
  //         retirement marked W — put rows in its FROM that add 0 to both, and
  //         only `matches` and `last_ball_at` read them; neither is read here.
  //   out   player_dismissals_since(): a wicket that stood dismissed him, or a
  //         retirement did — db/49's player_dismissals arms, NULLIF'd so a row
  //         counts once per player, as the function's OR does.
  //   bowl  player_bowling_since(): every delivery he bowled, the same CASEs.
  // `bat` and `out` take the batting anchor, `bowl` the bowling one, exactly
  // as the calls did. A date cast to timestamptz is midnight, so a match on
  // the afternoon of the assessment day counts towards it — which is the
  // right way round: the coach rated him in the nets that morning. A NULL
  // anchor is no window, as p_from IS NULL is in the functions.
  //
  // `sum` over an integer is bigint and `count` is bigint, as the functions
  // return, and a player with no row in `f` reads 0, as coalesce(…, 0) over
  // the functions' always-one-row answer did. Ties in full_name are broken by
  // id, where before they came out in whatever order the plan met them.
  //
  // ball_wicket_stands() is asked ONCE per delivery (`s`, fenced by OFFSET 0
  // so the planner cannot copy the call into each arm that reads it): on a
  // wicket whose method a free hit would save it looks up the ball before,
  // under the reader's policy, and the three arms that need the answer would
  // otherwise each ask. It is STABLE — one answer per row within a statement
  // — and for any row not marked W it is false without a lookup.
  // A wicket on a wide or a no-ball (db/87) stands as a W does: s.stands is
  // false for every delivery that is not a wicket, so it alone says so.
  const stoodOut = `case when b.kind = 'ball' and s.stands
                          then ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) end`;
  return `with r as materialized (
             select p.id as player_id, p.full_name, p.team_code, p.school_id,
                    ${cols.join(",\n                    ")}
               from player p${joins.join("")}
           ),
           ev as materialized (
             select who.player_id, who.fam, b.server_ts, who.runs, who.balls, who.wickets
               -- The career log (db/71), as the three functions it is held to read it.
               from ball_event_career b
               cross join lateral (select ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                                            as stands offset 0) s
               cross join lateral (values
                 ('bat',  case when b.kind = 'ball' then b.striker_id end,
                          ball_runs_off_bat(b.ball_type, b.value, b.payload),
                          case when b.ball_type <> 'Wd' then 1 else 0 end,
                          0),
                 ('out',  ${stoodOut}, 0, 0, 0),
                 ('out',  nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload), ${stoodOut}), 0, 0, 0),
                 ('bowl', case when b.kind = 'ball' then b.bowler_id end,
                          -- runsToBowler(): a no-ball's byes and leg byes are not his (Law 21.15, db/52)
                          ball_runs_to_bowler(b.ball_type, b.value, b.payload),
                          -- the balls of the over, as db/54 counts them (17.3.2.5)
                          case when ball_counts_in_over(b.ball_type, b.payload) then 1 else 0 end,
                          case when dismissal_is_bowlers(b.dismissal)
                                and s.stands then 1 else 0 end)
               ) as who(fam, player_id, runs, balls, wickets)
              where who.player_id is not null
           ),
           f as (
             select e.player_id,
                    sum(e.runs)    filter (where e.fam = 'bat')  as runs,
                    sum(e.balls)   filter (where e.fam = 'bat')  as balls_faced,
                    count(*)       filter (where e.fam = 'out')  as dismissals,
                    sum(e.runs)    filter (where e.fam = 'bowl') as runs_conceded,
                    sum(e.balls)   filter (where e.fam = 'bowl') as legal_balls,
                    sum(e.wickets) filter (where e.fam = 'bowl') as wickets
               from ev e
               join r on r.player_id = e.player_id
              where (case when e.fam = 'bowl' then r.bowling_anchor else r.batting_anchor end) is null
                 or e.server_ts >= (case when e.fam = 'bowl' then r.bowling_anchor else r.batting_anchor end)::timestamptz
              group by e.player_id
           )
           select r.*,
                  coalesce(f.runs, 0)          as runs,
                  coalesce(f.balls_faced, 0)   as balls_faced,
                  coalesce(f.dismissals, 0)    as dismissals,
                  coalesce(f.runs_conceded, 0) as runs_conceded,
                  coalesce(f.legal_balls, 0)   as balls_bowled,
                  coalesce(f.wickets, 0)       as wickets
             from r
             left join f on f.player_id = r.player_id
            order by r.full_name, r.player_id`;
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
/** @param {any[]} rows  ball_event rows, with the match's over count joined in */
function composePhases(rows) {
  // Every row carries the match's over count, joined in SQL. Twenty is the
  // fallback for a match with none recorded, not a default anyone can send.
  const overs = Number.isFinite(rows[0]?.overs) ? rows[0].overs : 20;
  /** @type {Map<number, any[]>} */
  const byInnings = new Map();
  for (const r of rows) {
    const n = r.innings ?? 1;
    if (!byInnings.has(n)) byInnings.set(n, []);
    /** @type {any[]} */ (byInnings.get(n)).push(fromRow(r));   // set just above when absent
  }
  // The match's format, joined the same way: whether a no-ball gives a free
  // hit, and so whether a wicket off the next ball stands (SCRBRD-113).
  const ctx = { format: rows[0]?.format ?? null };
  const innings = [...byInnings.keys()].sort((a, b) => a - b)
    .map((n) => deriveInnings(
      // n came from byInnings.keys(), so get() finds it.
      [{ kind: "innings_start", overs, squad: [], bowlingSquad: [] }, .../** @type {any[]} */ (byInnings.get(n))], ctx));
  const { first, second } = deriveMatchPhases(innings);
  // One row per innings, so the shape matches every other read: a list.
  return [first, second]
    .map((ph, i) => (ph ? { innings: i + 1, phases: ph } : null))
    .filter(Boolean);
}

/** @param {any[]} rows  ratingsQuery() rows */
function composeRatings(rows) {
  return rows.map((r) => {
    // The two disciplines the ball log can speak to. The others have no index
    // and adjustedRating() reports "coach" rather than inventing a half.
    /** @type {Partial<Record<string, { value: number | null }>>} */
    const index = {
      batting: battingIndex({
        runs: Number(r.runs), ballsFaced: Number(r.balls_faced), dismissals: Number(r.dismissals),
      }),
      bowling: bowlingIndex({
        runsConceded: Number(r.runs_conceded), ballsBowled: Number(r.balls_bowled),
        wickets: Number(r.wickets),
      }),
    };
    /** @type {Partial<Record<string, number>>} */
    const sample = { batting: Number(r.balls_faced), bowling: Number(r.balls_bowled) };

    /** @type {Record<string, unknown>} */
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

const AUDIT_KINDS = new Set(["access", "scoring", "amendment", "scorebook", "support", "role", "duty"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The audit log's query string, checked before it reaches SQL: a malformed
 * value is the caller's mistake (400), not a failed read.
 * @param {Record<string, string> | undefined} q
 */
function auditLogParams(q) {
  const bad = (/** @type {string} */ key) => {
    const e = /** @type {DressedError} */ (new Error(`bad_param:${key}`)); e.status = 400; throw e;
  };
  const school = q?.schoolId || null;
  if (school && !UUID_RE.test(school)) bad("schoolId");
  const kinds = q?.kinds ? String(q.kinds).split(",").map((k) => k.trim()).filter(Boolean) : null;
  if (kinds && kinds.some((k) => !AUDIT_KINDS.has(k))) bad("kinds");
  const instant = (/** @type {string} */ key) => {
    const v = q?.[key];
    if (!v) return null;
    if (Number.isNaN(Date.parse(v))) bad(key);
    return v;
  };
  const beforeKey = q?.beforeKey ? String(q.beforeKey) : null;
  if (beforeKey && !/^[a-z]+:[0-9a-f-]+(:[a-z]+)?$/i.test(beforeKey)) bad("beforeKey");
  const limit = q?.limit ? Number(q.limit) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) bad("limit");
  return [school, kinds, instant("since"), instant("before"), beforeKey, limit];
}

/**
 * A uuid from the query: absent (null, unless required) or well formed.
 * @param {Record<string, string> | undefined} q @param {string} key @param {boolean} [required]
 */
function uuidParam(q, key, required = false) {
  const v = q?.[key];
  if (v === undefined || v === null || v === "") {
    if (!required) return null;
    const e = /** @type {DressedError} */ (new Error(`missing_param:${key}`)); e.status = 400; throw e;
  }
  if (!UUID_RE.test(String(v))) { const e = /** @type {DressedError} */ (new Error(`bad_param:${key}`)); e.status = 400; throw e; }
  return v;
}

/** @param {Record<string, string> | undefined} q @param {string} key */
function req(q, key) {
  const v = q?.[key];
  if (v === undefined || v === null || v === "") { const e = /** @type {DressedError} */ (new Error(`missing_param:${key}`)); e.status = 400; throw e; }
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
export const RESTRICTED_FIELDS = Object.freeze(/** @type {Record<string, string[]>} */ ({
  // `fitness` since SCRBRD-117 (db/58): the injury status tier, a health signal.
  players:  ["email", "phone", "born", "hometown", "houseatschool",
             "address", "guardian", "height", "weight", "id_number", "fitness"],
  // db/111 adds the nature tier's emergency_services and next_review_on, the
  // clinical tier's recorded_by, and the DSO's stamp (not read by `injuries`,
  // watched so that any read that returns it is logged).
  injuries: ["injury_type", "severity", "phase", "notes", "physio",
             "emergency_services", "next_review_on", "recorded_by", "dso_notified_at"],
  // GA-I19: a review's phase and clock (nature), and the physio's words and
  // who wrote them (clinical).
  injury_reviews: ["phase_after", "next_review_on", "note", "reviewed_by"],
  // The worklist: every row is why a named boy needs the physio, and when.
  injury_worklist: ["reason", "due_on"],
  emergency_contacts: ["phone", "phone_alt", "email"],
  trip_contacts:      ["phone", "phone_alt", "email"],
  // A certificate's own number is enough to impersonate its holder at the
  // next school that asks for it. Logged like a phone number is.
  clearance_register: ["reference"],
  clearances:         ["reference"],
  career:   [],
  // The same figures as `career`, one grain finer: nothing about a child
  // beyond what `career` already discloses to the same reader.
  career_by_season: [],
  dismissal_breakdown: [],
  skills:   ["score"],
  users:    ["email"],
  // The same columns as `users`, disabled accounts included (logsReads).
  accounts: ["email"],
  // A child's guardians and why a link ended (db/109): every read is logged
  // (logsReads); these name what came back.
  child_links: ["guardian_email", "ending_reason"],
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
  // GA-I26a (db/104): the history is the same judgement as `skills`, and a
  // coaching point is a note.
  skills_history:  ["score"],
  coaching_points: ["body"],
  // A target is a coach's judgement of where a named child should be (N5's
  // class), and "since the last look" names his last assessment and his
  // targets (db/105).
  targets:           ["target_score"],
  development_since: ["anchor", "targets"],
  // A disciplinary matter about a named child, and what the school decided to
  // do about it. Nothing here is masked — discipline.read gates the row — so
  // this entry is the ONLY reason an ordinary school-side read of one is
  // logged at all: the platform-wide branch below stamps a cross-school
  // reader whatever the resource says, and the branch after it stamps
  // everybody else only when a watched column comes back. Without these two
  // names a principal could read a child's record and leave no trace, which
  // is the half of SCRBRD-053 that was not about the policy.
  disciplinary_records: ["body", "outcome"],
  // Another school's children, by name, read for a fixture. Logged against
  // the school that was read — school_id on every row is theirs, not the
  // reader's — so the disclosure lands in the right school's log.
  opposition_squad: ["full_name"],
}));

/** Read a possibly-dotted path off a row. Flat names behave exactly as before. */
const pick = (/** @type {any} */ row, /** @type {string} */ path) =>
  path.split(".").reduce((v, k) => (v == null ? v : v[k]), row);

/** Which id column identifies the CHILD a row is about, for the log. */
/** @type {Record<string, string>} */
const SUBJECT_ID = { players: "id", injuries: "player_id", skills: "player_id",
                     injury_reviews: "player_id", injury_worklist: "player_id",
                     emergency_contacts: "player_id", trip_contacts: "player_id",
                     // Not logged on an ordinary read (no contact comes back);
                     // named here so a platform-wide or support read of it,
                     // which is always logged, names the child it counted.
                     emergency_contact_count: "player_id",
                     clearance_register: "person_id", clearances: "person_id",
                     users: "id", accounts: "id", child_links: "player_id", ratings: "player_id", notes: "player_id",
                     skills_history: "player_id", coaching_points: "player_id",
                     targets: "player_id", development_since: "player_id",
                     disciplinary_records: "player_id",
                     opposition_squad: "player_id" };

/** At most this many ids per entry. A log row is evidence, not a data export. */
const MAX_LOGGED_IDS = 500;

/**
 * Read a resource under the caller's principal.
 * @returns {Promise<any[]>} rows already row-filtered (RLS) and column-masked (views).
 * @param {Pool} pool @param {string} secret
 * @param {string | undefined} bearer  the Authorization header, as sent
 * @param {string} resource
 * @param {Record<string, string>} [query]
 * @param {{ omit?: readonly string[], file?: boolean, needsAny?: readonly string[] }} [opts]
 *   omit: columns taken off every row BEFORE the log is written, so the log
 *   records what was handed over, not what the query selected (an export's
 *   dropped columns); file: the rows leave as a file, so a read whose rows
 *   are each about a person is logged even when no watched column came back;
 *   needsAny: capabilities, any one held at a row's school, without which
 *   the read is refused before it runs (no school at all) or the row is left
 *   out (another school).
 */
export async function readResource(pool, secret, bearer, resource, query = {}, opts = {}) {
  // Object.hasOwn, not a bare index: READ_QUERIES is a plain object, so a URL
  // naming "constructor" or "__proto__" found Object.prototype's member, passed
  // the 404 and opened a transaction as the caller before failing elsewhere.
  const def = Object.hasOwn(READ_QUERIES, resource) ? READ_QUERIES[resource] : undefined;
  if (!def) { const e = /** @type {DressedError} */ (new Error("unknown_resource")); e.status = 404; throw e; }
  const params = def.params ? def.params(query) : [];
  const module = OWNER_OF_READ[resource];
  return runAsPrincipal(pool, secret, bearer, async client => {
    // NO JIT FOR A GOVERNED READ. Postgres compiles a query to machine code
    // when its estimated cost passes jit_above_cost (100 000), and every read
    // here runs through row-level security whose policies call app_can() and
    // the ball log's per-row functions, each costed at 100. So the estimates
    // run to hundreds of thousands on a few hundred rows: `career` over the
    // Awards walk's 545 balls was estimated at 455 547, and spent 1.4 s of its
    // 2.2 s compiling 1 581 functions before reading a row (EXPLAIN ANALYZE,
    // 21 Oct 2026). Compiling is CPU, so on a loaded runner it was what pushed
    // the read past the web client's 10 s abort. A read this size never earns
    // the compile back. Transaction-local, so it ends with this read, and it
    // changes how expressions run, never the plan or a single row.
    await client.query("set local jit = off");
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
        const e = /** @type {DressedError} */ (new Error("module_disabled"));
        e.status = 403; e.code = "module_disabled"; e.module = module;
        throw e;
      }
    }
    // A FILE THAT NEEDS A CAPABILITY (exports.mjs `needsAny`): the schools
    // where the caller holds one of them, asked before the read, so a caller
    // who holds none at any school is refused with nothing read or logged.
    /** @type {Set<string> | null} */
    let held = null;
    if (opts.needsAny?.length) {
      const asks = opts.needsAny.map((_, i) =>
        `app_can($${i + 1}, s.id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`);
      const { rows: schools } = await client.query(`select s.id from school s where ${asks.join(" or ")}`, [...opts.needsAny]);
      if (!schools.length) {
        const e = /** @type {DressedError} */ (new Error("not_exported"));
        e.status = 403; e.code = "not_exported";
        throw e;
      }
      held = new Set(schools.map((s) => s.id));
    }
    const { rows: raw } = await client.query(def.text, params);
    const composedAll = def.compose ? def.compose(raw) : raw;
    const composed = held ? composedAll.filter((/** @type {any} */ r) => held.has(r.school_id)) : composedAll;
    const omit = opts.omit?.length ? new Set(opts.omit) : null;
    const rows = omit
      ? composed.map((/** @type {Record<string, unknown>} */ r) =>
          Object.fromEntries(Object.entries(r).filter(([k]) => !omit.has(k))))
      : composed;

    // Log what was ACTUALLY RECEIVED, not what was asked for. Masking is per
    // row and per capability, so two people running this same query get
    // different columns back — logging the query would record a disclosure
    // that never happened for one of them.
    const watched = RESTRICTED_FIELDS[resource];
    const idCol = SUBJECT_ID[resource];
    const idsIn = (/** @type {any[]} */ some) => idCol
      ? [...new Set(some.map((r) => r[idCol]).filter(Boolean))].slice(0, MAX_LOGGED_IDS)
      : [];
    // A PLATFORM-WIDE READER'S EVERY READ IS ON THE RECORD (db/20). For the
    // owner's key or a platform administrator, a roster is not their
    // school's roster, it is every school's, and the read crosses a tenant
    // boundary whether or not a restricted column came back. One row per
    // school the rows came from, so each school's own auditor sees the
    // owner's read of THEIR children in THEIR log, rather than one row filed
    // under whichever school happened to sort first.
    //
    // A SUPPORT SESSION'S EVERY READ IS ON THE RECORD THE SAME WAY (db/22).
    // The session reaches one school as one of its roles, so the rows come
    // from that school and the stamp — support_access_id — is decided inside
    // log_restricted_read(), never sent from here.
    const { rows: [who] } = await client.query(
      `select app_is_platform_wide() as platform, app_support_access_id() is not null as support`);
    let logged = false;
    if (def.logsItself) {
      logged = true;
      // The SQL has already written this read's row, at the school it asked
      // about; a second from here would count one read twice.
    } else if (def.logsReads) {
      // A read of the record itself (the access log, the support sessions):
      // one row per school whose rows came back, whenever any of them is not
      // the reader's own — a person looking at their own sessions or their
      // own reads is not auditing anybody. Platform-wide and support stamps
      // are decided inside log_restricted_read(), as for every other read.
      // A resource whose rows are each about one person (SUBJECT_ID: the
      // `accounts` read) names, per school, the people whose rows came back
      // and the watched columns among them, as every other logged read does.
      const others = rows.filter((r) => r.mine !== true);
      const asked = def.logsReads(query).filter((id) => UUID_RE.test(id));
      for (const school of new Set(others.map((r) => r.school_id ?? null))) {
        const theirs = others.filter((r) => (r.school_id ?? null) === school);
        const ids = [...new Set([...asked, ...idsIn(theirs)])].slice(0, MAX_LOGGED_IDS);
        const disclosed = (watched ?? []).filter((f) => theirs.some((r) => pick(r, f) != null));
        await client.query(
          `select log_restricted_read($1, $2::uuid[], $3::text[], $4::uuid)`,
          [resource, ids, disclosed, school]);
        logged = true;
      }
    } else if ((who?.platform || who?.support) && rows.length) {
      const disclosed = (watched ?? []).filter((f) => rows.some((r) => pick(r, f) != null));
      for (const school of new Set(rows.map((r) => r.school_id ?? null))) {
        const mine = rows.filter((r) => (r.school_id ?? null) === school);
        await client.query(
          `select log_restricted_read($1, $2::uuid[], $3::text[], $4::uuid)`,
          [resource, idsIn(mine), disclosed, school]);
      }
      logged = true;
    } else if (watched?.length && rows.length) {
      const disclosed = watched.filter((f) => rows.some((r) => pick(r, f) != null));
      if (disclosed.length) {
        const school = rows.find((r) => r.school_id)?.school_id ?? null;
        await client.query(
          `select log_restricted_read($1, $2::uuid[], $3::text[], $4::uuid)`,
          [resource, idsIn(rows), disclosed, school]);
        logged = true;
      }
    }
    // A FILE ABOUT PEOPLE IS ON THE RECORD, whatever columns it carries. A
    // roster file with its masked columns dropped discloses no watched column,
    // and is still every child's name leaving the platform. One row per school
    // the rows came from, naming them, with no fields: what left is the file.
    if (opts.file && !logged && idCol && rows.length) {
      for (const school of new Set(rows.map((r) => r.school_id ?? null))) {
        const theirs = rows.filter((r) => (r.school_id ?? null) === school);
        await client.query(
          `select log_restricted_read($1, $2::uuid[], $3::text[], $4::uuid)`,
          [resource, idsIn(theirs), [], school]);
      }
    }
    return rows;
  });
}

/** Which resources are wired for live reads (for the client's feature flags / a health check). */
export function liveResources() { return Object.keys(READ_QUERIES); }

/**
 * Is this read answered with Cache-Control: no-store (a union's list, db/125)?
 * The dispatcher asks before it sends, so the header rides on errors too.
 * @param {string} resource
 */
export function readIsNoStore(resource) {
  return Object.hasOwn(READ_QUERIES, resource) && READ_QUERIES[resource].noStore === true;
}

/**
 * The reads the CSV route refuses: a policy list (packages/policy/src/
 * exports.mjs), derived from this file's watched columns and the tables each
 * read's SQL names, plus the reads the policy names. The route serves only the
 * policy's short allowlist (EXPORTABLE), and a test holds the two apart.
 */
export const NOT_EXPORTED = notExported({
  restricted: RESTRICTED_FIELDS,
  tablesRead: Object.fromEntries(Object.entries(READ_QUERIES).map(([r, d]) => [r, tablesIn(d.text)])),
});

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
 * @param {Pool} pool @param {string} secret
 * @param {string | undefined} bearer  the Authorization header, as sent
 * @param {string} resource
 * @param {Record<string, string>} [query]
 */
export async function exportResource(pool, secret, bearer, resource, query = {}) {
  // An unknown name is the read's own 404, before the policy is asked.
  if (!Object.hasOwn(READ_QUERIES, resource)) {
    const e = /** @type {DressedError} */ (new Error("unknown_resource")); e.status = 404; throw e;
  }
  // Only the policy's short list leaves as a file (packages/policy/src/
  // exports.mjs): a coach's judgement of a child, a child's health, conduct,
  // family or figures, and another school's boys do not. Refused before the
  // read, so nothing is read and nothing is logged: the screen is where these
  // are seen.
  if (!exportAllowed(resource, NOT_EXPORTED)) {
    const e = /** @type {DressedError} */ (new Error("not_exported"));
    e.status = 403; e.code = "not_exported";
    throw e;
  }
  // The file's dropped columns go for every reader alike: the office's roster
  // file carries no address or ID number either, though the screen shows them.
  const drop = exportDrops(resource);
  const rows = await readResource(pool, secret, bearer, resource, query,
                                  { omit: drop, file: true, needsAny: exportNeeds(resource) });
  const columns = rows.length
    ? Object.keys(rows[0])
    // An empty result still needs a header, or the file a school opens is a
    // blank page rather than a roster with nobody in it. The columns come from
    // the query's own text in that case, which is the only place they exist.
    : columnsOf(resource).filter((c) => !drop.includes(c));
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
/** @param {string} resource */
function columnsOf(resource) {
  const text = (Object.hasOwn(READ_QUERIES, resource) ? READ_QUERIES[resource]?.text : undefined) ?? "";
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
/**
 * @param {{ pool: Pool, secret: string }} deps
 * @returns {(req: ApiRequest, res: RawResponse) => Promise<unknown>}
 */
export function exportRoute({ pool, secret }) {
  return async (req, res) => {
    try {
      // The dispatcher always sets it, from the path.
      const resource = /** @type {string} */ (req.params.resource);
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
    } catch (/** @type {any} */ e) {
      res.status(e.status || 500).json({
        error: e.code || e.message, ...(e.module ? { module: e.module } : {}) });
    }
  };
}

// ── Express/Fastify route: GET /read/:resource ──
/** @param {{ pool: Pool, secret: string }} deps @returns {Handler} */
export function readRoute({ pool, secret }) {
  return async (req, res) => {
    try {
      const rows = await readResource(pool, secret, req.headers?.authorization, /** @type {string} */ (req.params.resource), req.query || {});   // set by the dispatcher, from the path
      res.json({ resource: req.params.resource, rows });
    } catch (/** @type {any} */ e) {
      // A word the read's SQL refuses with (invalid_parameter_value), said as
      // that word: the caller asked wrongly, and the server did not fail.
      const resource = /** @type {string} */ (req.params.resource);
      const def = Object.hasOwn(READ_QUERIES, resource) ? READ_QUERIES[resource] : undefined;
      if (e?.code === "22023" && def?.refuses?.includes(e.message)) {
        res.status(422).json({ error: e.message });
        return;
      }
      // `module` rides along on a module refusal so a client can say WHICH
      // one is off instead of rendering "could not load" — a screen that
      // reports a switched-off module as a failure sends somebody looking for
      // an outage that is a setting.
      res.status(e.status || 500).json({
        error: e.code || e.message, ...(e.module ? { module: e.module } : {}) });
    }
  };
}
