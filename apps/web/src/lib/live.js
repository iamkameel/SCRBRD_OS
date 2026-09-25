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
import { scoped, scopedSkills, scopedWeather, demoSummary } from "../rbac/index.js";

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
    // HH:MM, sliced the same way `date` is rather than through a Date object
    // and a timezone conversion — a day-of screen naming a kickoff time is the
    // one thing worse than naming none: this is the raw instant the fixture
    // was scheduled at, exactly as written.
    time: r.starts_at ? String(r.starts_at).slice(11, 16) : null,
    status: MATCH_STATUS[r.status] ?? "upcoming",
    result: null,
    competition: null,
    // The school season this fixture falls in, from the same season_for()
    // rule the calendar uses — never derived again here from the date, so a
    // season history view and the database can never name a fixture into two
    // different years.
    season: r.season ?? null,
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
    schoolName: r.school_name ?? null,
    squadNo: r.squad_no,
    role: r.playing_role,
    batHand: r.batting_style,
    bowlArm: r.bowling_arm,
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
           // The roster record this account belongs to, when it belongs to one.
           // A coach's account links to nobody; a pupil's links to the child
           // whose passport, squad entry and profile are all keyed on it.
           player: r.player_id ?? null,
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
  return { id: r.id ?? `${r.competition_id}:${r.school_id}:${r.team_code ?? ""}`,
           competition: r.competition_id,
           name: r.display_name, school: r.school_id, team: r.team_code,
           played: r.played, wins: r.won, losses: r.lost, draws: r.drawn,
           noResult: r.no_result, points: r.points, nrr: r.net_run_rate,
           division: r.division_id ? { id: r.division_id, code: r.division_code, name: r.division_name, rank: r.division_rank } : null,
           live: true };
}
function asSeason(r) {
  return { id: r.id, level: r.level, label: r.label, startsOn: String(r.starts_on).slice(0, 10),
           endsOn: String(r.ends_on).slice(0, 10), cutoffOn: String(r.cutoff_on).slice(0, 10), current: r.current === true, live: true };
}
function asDivision(r) {
  return { id: r.id, competition: r.competition_id, code: r.code, name: r.name, rank: r.rank, entrants: r.entrants, live: true };
}

function asCompetition(r) {
  return { id: r.id, name: r.name, type: r.comp_type, format: r.format,
           ageGroup: r.age_group, gender: r.gender, season: r.season, level: r.level, divisions: r.divisions ?? 0,
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

/**
 * An appointment: who stood, at which fixture, in what duty.
 *
 * `person_name` is the name AS APPOINTED and is stored on the row rather than
 * joined — see match_official in db/08. So a directory built from these needs
 * no second read and cannot show a blank where an umpire should be.
 */
/**
 * A notice, in the product's words.
 *
 * `scope` is kept because it is the whole point of the row: a reader needs to
 * know whether they are looking at something for their side, their school, or
 * the league, and the three read very differently. `audience` renders that as
 * the thing it actually names rather than as the word "team".
 */
function asNewsPost(r) {
  const audience = r.scope === "team" ? (r.team_code || "Team")
                 : r.scope === "school" ? (r.school_name || "School")
                 : (r.competition_name || "Competition");
  return {
    id: r.id,
    scope: r.scope,
    audience,
    title: r.title,
    body: r.body,
    author: r.author_name || "The office",
    publishedAt: r.published_at,
    // A post the author has not sent yet comes back to the author alone, and
    // is labelled — an unlabelled draft looks like a notice nobody else got.
    draft: r.published_at == null,
    at: r.published_at || r.created_at,
  };
}

function asOfficial(r) {
  return { id: r.id ?? null, matchId: r.match_id, duty: r.duty, name: r.person_name,
           personId: r.person_id, officialId: r.official_id,
           panel: r.panel, appointedAt: r.appointed_at,
           // SCRBRD-034: the duty rests on an assignment, and whether the
           // office has paused it. Why is the office's (duty_suspensions).
           linked: r.linked === true, suspended: r.suspended === true, live: true };
}

/** The office's record of a suspended duty: who, when and why, both ways. */
function asDutySuspension(r) {
  return { id: r.id, dutyId: r.duty_id, matchId: r.match_id, duty: r.duty, name: r.person_name,
           suspendedAt: r.suspended_at, reason: r.reason, suspendedBy: r.suspended_by_name,
           liftedAt: r.lifted_at ?? null, liftReason: r.lift_reason ?? null, liftedBy: r.lifted_by_name ?? null,
           live: true };
}

/**
 * Somebody on the officials register.
 *
 * `level` is null in two different situations and the screen must not collapse
 * them: an official who has never held an accreditation, and one whose
 * accreditation has run out. `accreditations` tells them apart — none at all
 * versus some, none current — so "not accredited" and "lapsed" can be
 * different words on the screen, which is the difference between somebody who
 * was never on the ladder and somebody who needs to renew.
 *
 * born / idNumber / email / phone arrive NULL for every reader but the union
 * that keeps the register. That is the mask doing its job, not missing data,
 * so they are passed through as null rather than defaulted to anything.
 */
function asRegisteredOfficial(r) {
  return {
    id: r.id,
    name: r.full_name,
    panel: r.panel,
    active: r.active,
    level: r.level ?? null,
    accreditations: Number(r.accreditations ?? 0),
    accreditedUntil: r.accredited_until ? String(r.accredited_until).slice(0, 10) : null,
    born: r.born ? String(r.born).slice(0, 10) : null,
    idNumber: r.id_number ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    live: true,
  };
}

/**
 * The groundsman's record of a ground. Absent fields are absent, never zeroed:
 * a square nobody measured has no moisture reading, and 0% would be a claim
 * that it is bone dry.
 */
function asGroundCondition(r) {
  return { groundId: r.ground_id, moisturePct: r.moisture_pct, grassMm: r.grass_mm,
           roller: r.roller, outfield: r.outfield, drainageMin: r.drainage_min,
           lastRolled: r.last_rolled ? String(r.last_rolled).slice(0, 10) : null,
           lastMown: r.last_mown ? String(r.last_mown).slice(0, 10) : null,
           notes: r.notes, reportedAt: r.reported_at, live: true };
}

/**
 * A sponsor, as the school office signed them.
 *
 * `categoryPermitted` and `categoryNote` ride along from the join. They are
 * not decoration: a brand signed under a category that is later prohibited
 * stays on the row, and a screen that showed it without saying so would be
 * telling a school everything is fine.
 */
function asSponsor(r) {
  return { id: r.id, name: r.name, category: r.category,
           logoText: r.logo_text, logoBg: r.logo_bg, active: r.active,
           categoryPermitted: r.category_permitted, categoryNote: r.category_note,
           live: true };
}

/** The vocabulary, permitted and refused alike — the refused ones carry why. */
function asSponsorCategory(r) {
  return { name: r.name, permitted: r.permitted, note: r.note, live: true };
}

/**
 * A placement, WITH THE TERMS POSSIBLY ABSENT.
 *
 * contractValueZar and schoolSharePct arrive null for anybody without
 * sponsorship.finance.read, masked per row inside sponsorship_masked. This
 * adapter does NOT substitute a zero or a dash for them, and the distinction
 * it cannot make — masked from this reader, versus never recorded — is one the
 * screen has to make for itself. See SponsorsView for how.
 */
function asSponsorship(r) {
  return { id: r.id, sponsorId: r.sponsor_id, sponsorName: r.sponsor_name,
           category: r.category, logoText: r.logo_text, logoBg: r.logo_bg,
           placement: r.placement, matchId: r.match_id,
           exclusive: r.exclusive === true, exclusiveScope: r.exclusive_scope,
           competitionId: r.competition_id, waived: r.waived === true,
           startsOn: r.starts_on ? String(r.starts_on).slice(0, 10) : null,
           endsOn:   r.ends_on   ? String(r.ends_on).slice(0, 10)   : null,
           contractValueZar: r.contract_value_zar == null ? null : Number(r.contract_value_zar),
           schoolSharePct:   r.school_share_pct   == null ? null : Number(r.school_share_pct),
           agreedAt: r.agreed_at, running: r.is_running === true, live: true };
}

/**
 * One switchable thing, with its three levels reported separately.
 *
 * Nothing is collapsed here. `resolved` is the server's own answer and the
 * only one a screen should act on; platformDefault, schoolGranted and the
 * suppressions are how it came to be that way, and an administrator staring at
 * one boolean cannot tell which conversation they are in.
 */
function asModuleSetting(r) {
  return { key: r.key, kind: r.kind, label: r.label,
           platform_default: r.platform_default, locked: r.locked, reason: r.reason,
           school_granted: r.school_granted, grantNote: r.grant_note,
           school_hidden: r.school_hidden, people_hidden: r.people_hidden,
           resolved: r.resolved, changedAt: r.changed_at, live: true };
}

/** Who a module is hidden from at one school, and why. */
function asModuleSuppression(r) {
  return { key: r.key, school: r.school_id, personId: r.person_id,
           personName: r.person_name, reason: r.reason, hiddenAt: r.hidden_at, live: true };
}

/** What is on for THIS session, already resolved across every school they belong to. */
function asMyFeature(r) {
  return { key: r.key, kind: r.kind, label: r.label, enabled: r.enabled === true, live: true };
}

/**
 * A vehicle in the school's fleet.
 *
 * Absent fields stay absent. A bus with no recorded service date has no
 * service date — not one in 1970, and not "due", which is what a zero would
 * have read as on the Logistics screen.
 */
function asVehicle(r) {
  return { id: r.id, reg: r.registration, description: r.description, kind: r.kind,
           capacity: r.capacity, condition: r.condition, active: r.active,
           nextService: r.next_service_on ? String(r.next_service_on).slice(0, 10) : null,
           notes: r.notes, school: r.school_id, insuranceExpiresOn: r.insurance_expires_on ? String(r.insurance_expires_on).slice(0, 10) : null,
           roadworthyExpiresOn: r.roadworthy_expires_on ? String(r.roadworthy_expires_on).slice(0, 10) : null,
           coverState: r.cover_state ?? "unknown", live: true };
}

/**
 * A trip to a fixture. `state` is the server's single word for where the bus
 * is, derived once in SQL rather than re-derived from three timestamps by
 * every screen that draws it.
 */
function asTrip(r) {
  return { id: r.id, matchId: r.match_id, school: r.school_id,
           vehicleId: r.vehicle_id, reg: r.registration,
           vehicleDescription: r.vehicle_description, capacity: r.capacity, kind: r.kind,
           driverId: r.driver_id, driverName: r.driver_name,
           departAt: r.depart_at, returnAt: r.return_at,
           pickup: r.pickup, seatsTaken: r.seats_taken, notes: r.notes,
           departedAt: r.departed_at, arrivedAt: r.arrived_at,
           state: r.state, live: true };
}

/** One boy's answer about one fixture, and null status means he has not answered. */
function asAvailability(r) {
  return { playerId: r.player_id, name: r.full_name, team: r.team_code,
           status: r.status, reasonKind: r.reason_kind, note: r.note,
           declaredAt: r.declared_at, selfDeclared: r.self_declared === true,
           declaredByName: r.declared_by_name,
           // Deliberately NOT coerced to a boolean. Null is a third answer
           // here — the school does not run the Injuries module, so no
           // clinical opinion is being collected — and `=== true` turned that
           // into "cleared", which is the one reading nothing asserted.
           clinicallyRestricted: r.clinically_restricted ?? null, live: true };
}

/**
 * One sport, with the two facts the shell's hard-coded list conflated.
 *
 * `enabled` is whether this school has been granted it. `engine` is how much
 * of the product exists for it, and the client must show them separately: a
 * sport can be on with a fixture engine and no scorer, and a badge reading
 * "live" over that is the promise the old constant was making.
 */
function asSport(r) {
  return { code: r.code, label: r.label, engine: r.engine,
           enabled: r.enabled === true, fixtures: r.fixtures ?? 0,
           // Convenience for the shell, derived here rather than in six
           // components: scoring is the only engine that puts a scorer's
           // screen behind a sport.
           scorable: r.engine === "scoring", live: true };
}

/**
 * The header of an opposition brief. `open` false with a `reason` is a real
 * state to render — "opens on the 5th", "the match has started" — not an
 * error; no row at all means this reader has no standing and the screen
 * should say nothing.
 */
function asOppositionContext(r) {
  return { matchId: r.match_id, mySide: r.my_side, theirSchool: r.their_school,
           theirLabel: r.their_label, theirTeam: r.their_team,
           opensAt: r.opens_at, closesAt: r.closes_at, open: r.open === true,
           reason: r.reason, gamesAnalysed: r.games_analysed,
           deliveriesAnalysed: r.deliveries_analysed, dataCutoff: r.data_cutoff, live: true };
}

/**
 * One opposition player and the evidence behind each figure. A null
 * strikeRate is not missing data — it is the floor: fewer than thirty balls
 * and the number is withheld, with `battingEvidence` saying so. Render an em
 * dash and the label, never a fallback figure.
 */
function asOppositionPlayer(r) {
  return { playerId: r.player_id, school: r.school_id, name: r.full_name, team: r.team_code,
           role: r.playing_role, battingStyle: r.batting_style, bowlingStyle: r.bowling_style,
           batting: { innings: r.innings, balls: r.balls, runs: r.runs, dismissals: r.dismissals,
                      fours: r.fours, sixes: r.sixes, dots: r.dots,
                      strikeRate: r.strike_rate == null ? null : Number(r.strike_rate),
                      dotPct: r.dot_pct == null ? null : Number(r.dot_pct),
                      evidence: r.batting_evidence },
           bowling: { balls: r.balls_bowled, runsConceded: r.runs_conceded, wickets: r.wickets,
                      economy: r.economy == null ? null : Number(r.economy),
                      evidence: r.bowling_evidence },
           live: true };
}

/**
 * An innings in three parts, already in the product's vocabulary.
 *
 * Unlike every other adapter in this file this one is nearly an identity, and
 * that is deliberate rather than lazy: the phases read is COMPOSED on the
 * server by the same derivePhases() the scorer's device runs, so what arrives
 * is already the scoring package's names — runRate, dotPct, controlPct — and
 * not the database's columns. Renaming any of it here would put a second
 * vocabulary between the fold and the screen, which is exactly the drift the
 * shared package exists to prevent: a phase breakdown that disagreed with the
 * scorecard beside it would be worse than none, because both look
 * authoritative and nothing could say which was right.
 *
 * THE NULLS ARE THE LOAD-BEARING PART and are passed through untouched:
 * `runRate` null when no balls were bowled in the phase, `controlPct` and
 * `beatenPct` null when no contact was recorded at all, `par` and `vsPar`
 * null in a first innings because there is nothing yet to be level with. A
 * zero in any of their places is a fabrication, and a screen that cannot tell
 * "nobody was watching that closely" from "he middled nothing" has invented a
 * batter who is out of touch.
 */
function asPhases(r) {
  return { innings: r.innings, phases: r.phases, live: true };
}

/**
 * The head-to-head against one rival, DERIVED — never a stored tally.
 *
 * `undecided` is the honest column and must be drawn, not dropped: a fixture
 * whose toss was never recorded has known scores and no attributable winner,
 * and a record reading "won 6" when two more were played that nobody can
 * judge is a lie of omission. A win rate computed over `played` would repeat
 * it, so the percentage belongs over the decided games only.
 *
 * Two people will legitimately get different totals for the same rivalry:
 * this is counted over the fixtures each of them may see.
 */
function asDerby(r) {
  const decided = (r.won ?? 0) + (r.lost ?? 0) + (r.tied ?? 0);
  return {
    school: r.school_id, opponent: r.opponent, rivalKey: r.rival_key,
    awaySchool: r.away_school_id, title: r.title, sinceYear: r.since_year,
    played: r.played, won: r.won, lost: r.lost, tied: r.tied, undecided: r.undecided,
    decided,
    // Null rather than zero when nothing is decided: 0% would read as "we
    // always lose" for a rivalry whose results are simply unattributable.
    winPct: decided ? Math.round((r.won / decided) * 100) : null,
    lastPlayed: r.last_played,
    recent: (r.recent ?? []).map((x) => ({
      startsAt: x.starts_at, team: x.team_code, result: x.result,
      firstRuns: x.first_runs, secondRuns: x.second_runs,
    })),
    live: true,
  };
}

/**
 * One batter against one bowler, from the ball log.
 *
 * `bowlingStyle` rides along so a screen can aggregate the pairs into what a
 * coach actually plans against — left-arm orthodox, right-arm quick — rather
 * than only naming individuals.
 */
function asMatchup(r) {
  return {
    batterId: r.batter_id, batterName: r.batter_name,
    bowlerId: r.bowler_id, bowlerName: r.bowler_name, bowlingStyle: r.bowling_style,
    balls: r.balls, runs: r.runs, dots: r.dots, fours: r.fours, sixes: r.sixes,
    dismissals: r.dismissals,
    strikeRate: r.balls ? Math.round((r.runs / r.balls) * 1000) / 10 : null,
    live: true,
  };
}

/**
 * How much of the log the match-ups can speak for.
 *
 * Most bowlers a school's batter faces are not SCRBRD players, so those
 * deliveries carry no bowler_id and are invisible to the match-up query. A
 * screen that showed "12 balls faced" without saying it had ignored 300
 * others would be stating something false with a number on it — so this is
 * read beside them and drawn beside them.
 */
function asMatchupCoverage(r) {
  const total = r.deliveries ?? 0;
  return {
    attributable: r.attributable, unattributable: r.unattributable, deliveries: total,
    pct: total ? Math.round((r.attributable / total) * 100) : null,
    live: true,
  };
}

/**
 * One chapter of where a boy has played. `current` marks the side he is in
 * now; everything else is history, closed by the move that ended it and
 * editable by nobody.
 */
function asMembership(r) {
  return { id: r.id, playerId: r.player_id, name: r.full_name,
           school: r.school_id, sport: r.sport, team: r.team_code,
           joinedOn: r.joined_on ? String(r.joined_on).slice(0, 10) : null,
           leftOn: r.left_on ? String(r.left_on).slice(0, 10) : null,
           reason: r.reason, current: r.current === true, live: true };
}

/**
 * One of my own phones. Never anybody else's — see the my_devices read.
 *
 * `live` is the registration's state, not a connection: a retired row is kept
 * because "signed out on the iPad in March" is the answer to "why did I stop
 * getting alerts", and a settings screen showing only live rows cannot give it.
 */
function asDevice(r) {
  // sessionDeviceId, not deviceId: lib/device.js already exports a deviceId
  // and the import checker catches the collision — the third time that trap
  // has been walked into here, after a local named signedIn and an adapter
  // key named grantedBy.
  return { id: r.id, platform: r.platform, label: r.label, sessionDeviceId: r.device_id,
           registeredAt: r.registered_at, lastSeenAt: r.last_seen_at,
           retiredAt: r.retired_at, retiredReason: r.retired_reason,
           tokenTail: r.token_tail, active: r.retired_at == null, live: true };
}

/**
 * Who to ring for a child, one row per contact in priority order. The same
 * shape serves the manifest read, where rows carry the child's name too.
 */
function asContact(r) {
  return { id: r.id ?? null, playerId: r.player_id, playerName: r.full_name, school: r.school_id,
           priority: r.priority, name: r.name, relationship: r.relationship,
           phone: r.phone, phoneAlt: r.phone_alt, email: r.email, note: r.note, live: true };
}

/** One row of the clearance register, or one adult's clearance. The word is the server's. */
function asClearance(r) {
  const d = (v) => (v ? String(v).slice(0, 10) : null);
  return { id: r.id ?? r.clearance_id ?? null, personId: r.person_id ?? null, name: r.name ?? null,
           role: r.role ?? null, school: r.school_id, schoolName: r.school_name ?? null,
           kind: r.kind, kindLabel: r.kind_label, status: r.status, reference: r.reference ?? null,
           issuedOn: d(r.issued_on), expiresOn: d(r.expires_on), note: r.note ?? null,
           verifiedBy: r.verified_by_name ?? null, verifiedAt: r.verified_at ?? null,
           revokedAt: r.revoked_at ?? null, revokedReason: r.revoked_reason ?? null, live: true };
}
/** One boy's workload. Every word and number is the server's. */
function asWorkload(r) {
  return { playerId: r.player_id, name: r.full_name, team: r.team_code, school: r.school_id,
           ageBand: r.age_band, pace: r.pace, maxSpell: r.max_overs_per_spell, maxDay: r.max_overs_per_day,
           overs7d: r.overs_7d, overs28d: r.overs_28d, longestSpell7d: r.longest_spell_7d,
           breaches28d: r.breaches_28d, lastBowledOn: r.last_bowled_on ? String(r.last_bowled_on).slice(0, 10) : null,
           sessions7d: r.sessions_7d, minutes7d: r.minutes_7d, sessions28d: r.sessions_28d, minutes28d: r.minutes_28d,
           acwr: r.acwr == null ? null : Number(r.acwr), loadState: r.load_state,
           // The rulebook clause his limit enforces (SCRBRD-041), or null for a
           // boy under no limit — the server decides which, not this screen.
           clause: r.clause_code ? { code: r.clause_code, title: r.clause_title,
                                     severity: r.clause_severity, body: r.clause_body } : null,
           live: true };
}
function asSpell(r) {
  return { matchId: r.match_id, innings: r.innings, bowlerId: r.bowler_id, name: r.full_name,
           spellNo: r.spell_no, firstOver: r.first_over, lastOver: r.last_over, overs: r.overs,
           legalBalls: r.legal_balls, bowledOn: r.bowled_on ? String(r.bowled_on).slice(0, 10) : null,
           ageBand: r.age_band, pace: r.pace, maxSpell: r.max_overs_per_spell, maxDay: r.max_overs_per_day,
           overSpellLimit: r.over_spell_limit, breachRecorded: r.breach_recorded, live: true };
}
function asBreach(r) {
  return { id: r.id, matchId: r.match_id, opponent: r.opponent, innings: r.innings, bowlerId: r.bowler_id,
           name: r.full_name, team: r.team_code, kind: r.kind, overs: r.overs, allowed: r.allowed,
           ageBand: r.age_band, bowledOn: r.bowled_on ? String(r.bowled_on).slice(0, 10) : null,
           noticedAt: r.noticed_at, live: true };
}
function asDirective(r) { return { ageBand: r.age_band, maxSpell: r.max_overs_per_spell, maxDay: r.max_overs_per_day, clauseCode: r.clause_code ?? null, live: true }; }
/** A rulebook clause (db/32). The limits are bowling_directive's, joined by the server. */
function asClause(r) {
  return { code: r.code, title: r.title, body: r.body, category: r.category, severity: r.severity,
           source: r.source, ages: r.applicable_ages ?? [],
           limits: (r.limits ?? []).map((l) => ({ ageBand: l.age_band, maxSpell: l.max_overs_per_spell, maxDay: l.max_overs_per_day })),
           live: true };
}
const d10 = (v) => (v ? String(v).slice(0, 10) : null);
/** One line of a boy's recognition: an honour, a cap, or a milestone. The label is the server's. */
function asRecognition(r) {
  return { family: r.family, kind: r.kind, label: r.label, value: r.value, season: r.season, on: d10(r.on_date),
           matchId: r.match_id, opponent: r.opponent, isPublic: r.is_public, citation: r.citation, id: r.ref_id, live: true };
}
/**
 * One placed delivery, in the shape the wagon wheel already reads.
 *
 * The chart is the scorer's and expects a ball off the pad's own log —
 * `type`, `placementSource`, `strikerId`. The server speaks the column names.
 * Translating here rather than in the view is what keeps the chart single:
 * a second wheel that understood snake_case would be a second implementation
 * of the mirror rule, and those two drift the first time either is touched.
 */
function asShotPoint(r) {
  // radius is numeric(3,2), which node-postgres returns as a STRING rather
  // than lose precision silently. The wheel's geometry multiplies it, so it is
  // coerced once here instead of relying on each use site to coerce it.
  return { type: r.ball_type, value: r.value, shot: r.shot,
           theta: r.theta == null ? null : Number(r.theta),
           radius: r.radius == null ? null : Number(r.radius),
           seg: r.seg,
           placementSource: r.placement_source, captureProfile: r.capture_profile,
           // The innings' declared profile (SCRBRD-039), not the ball's own:
           // the charts read each ball against what its innings asked for.
           declaredProfile: r.declared_profile ?? null,
           strikerId: r.striker_id, bowlerId: r.bowler_id,
           matchId: r.match_id, innings: r.innings, seq: r.seq, live: true };
}
function asCap(r) {
  return { school: r.school_id, team: r.team_code, playerId: r.player_id, name: r.full_name, capNo: r.cap_no,
           appearances: r.appearances, firstOn: d10(r.first_on), lastOn: d10(r.last_on), firstMatchId: r.first_match_id,
           baselineSet: r.baseline_set, live: true };
}
/**
 * A fixture's pitch report, in the client's vocabulary. Read by
 * SCRBRD-058's FieldsView form to pre-fill an existing report before it is
 * edited — `on conflict (match_id) do update` overwrites every column, so a
 * form that started blank would silently null out whatever was not
 * re-entered.
 */
function asPitchReport(r) {
  return { matchId: r.match_id, surface: r.surface, grass: r.grass, bounce: r.bounce,
           pace: r.pace, favours: r.favours, coversOn: r.covers_on, notes: r.notes,
           bounceRating: r.bounce_rating, paceRating: r.pace_rating, outfield: r.outfield,
           reportedAt: r.reported_at, live: true };
}
function asHonour(r) {
  return { id: r.id, playerId: r.player_id, name: r.full_name, school: r.school_id, team: r.team_code, kind: r.kind,
           awardName: r.name, label: r.label, season: r.season, citation: r.citation, awardedOn: d10(r.awarded_on),
           isPublic: r.is_public, awardedBy: r.awarded_by_name, live: true };
}
function asMilestone(r) {
  return { playerId: r.player_id, name: r.full_name, team: r.team_code, kind: r.kind, label: r.label, value: r.value,
           matchId: r.match_id, innings: r.innings, opponent: r.opponent, on: d10(r.played_on), live: true };
}
function asRoleRequest(r) {
  return { id: r.id, personId: r.person_id, name: r.name, email: r.email, role: r.role, school: r.school_id,
           schoolName: r.school_name, team: r.team_code, playerId: r.player_id, note: r.note, state: r.state,
           requestedAt: r.requested_at, decidedAt: r.decided_at, decidedNote: r.decided_note, decidedBy: r.decided_by_name,
           mine: r.mine === true, decidable: r.decidable === true, live: true };
}
function asDrill(r) {
  return { id: r.id, school: r.school_id, name: r.name, category: r.category, duration: r.duration_min, desc: r.description, live: true };
}
function asEquipment(r) {
  return { id: r.id, school: r.school_id, kind: r.kind, label: r.label, quantity: r.quantity, condition: r.condition, notes: r.notes, out: r.out, live: true };
}
function asIssue(r) {
  return { id: r.id, equipmentId: r.equipment_id, label: r.label, kind: r.kind, playerId: r.player_id, name: r.full_name,
           team: r.team_code, issuedOn: String(r.issued_on).slice(0, 10), returnedOn: r.returned_on ? String(r.returned_on).slice(0, 10) : null, live: true };
}
function asPassportLine(r) {
  return { family: r.family, label: r.label, value: r.value, on: r.on_date ? String(r.on_date).slice(0, 10) : null,
           source: r.source_school, recordedBy: r.recorded_by, confidence: r.confidence, live: true };
}
function asPassportConsent(r) {
  return { id: r.id, playerId: r.player_id, name: r.full_name, toSchool: r.to_school_id, toSchoolName: r.to_school,
           grantedAt: r.granted_at, withdrawnAt: r.withdrawn_at, live: true };
}
/**
 * SCRBRD-055. `granted` is derived from the state rather than sent as a
 * boolean on purpose: the table's vocabulary is 'granted' | 'withdrawn', and a
 * row that is neither — an unknown state from a later migration — must not
 * read as granted because a boolean coerced it.
 */
function asScoutingConsent(r) {
  return { playerId: r.player_id, name: r.full_name, team: r.team_code,
           state: r.consent_state,
           granted: r.consent_state === "granted",
           decidedAt: r.decided_at ? String(r.decided_at).slice(0, 10) : null,
           decidedBy: r.decided_by_name ?? null, live: true };
}
/**
 * SCRBRD-037. One recorded duty. The read returns ONLY what is on record, so
 * every row here is something somebody actually did — which is what lets the
 * panel say "nothing on record" for the rest without guessing whether it
 * should have been.
 */
function asDuty(r) {
  // `status` is the server's duty_status() (db/30), null on every row that is
  // not an appointment. Carried as the server answered it — the client never
  // derives a lifecycle of its own.
  return { duty: r.duty, who: r.who || null, state: r.state,
           status: r.status ?? null,
           detail: r.detail || null,
           at: r.at ? String(r.at).slice(0, 10) : null, live: true };
}
function asRequirement(r) { return { role: r.role, kind: r.kind, kindLabel: r.kind_label, live: true }; }

/**
 * A DRS review of one delivery — see `drs_reviews` in read-api.mjs.
 *
 * `pitching`, `impact` and `wickets` are the ball-tracking components and
 * arrive NULL until there is ball-tracking to measure them; nothing here
 * invents a value in their place. This resource is reachable only while the
 * `drs_review` feature is on for the school — off, the read itself is
 * refused before any row reaches this adapter (see apps/web/src/views/drs.jsx).
 */
function asDrsReview(r) {
  return {
    matchId: r.match_id, ballSeq: r.ball_seq,
    evidenceSource: r.evidence_source, calledBy: r.called_by,
    onField: r.on_field, outcome: r.outcome,
    pitching: r.pitching, impact: r.impact, wickets: r.wickets,
    shotOffered: r.shot_offered, notes: r.notes || null,
    reviewedAt: r.reviewed_at, live: true,
  };
}

/** A side as it stood on a date — nothing here is computed in the browser. */
function asRosterOn(r) {
  return { playerId: r.player_id, name: r.full_name, team: r.team_code,
           joinedOn: r.joined_on ? String(r.joined_on).slice(0, 10) : null,
           leftOn:   r.left_on   ? String(r.left_on).slice(0, 10)   : null, live: true };
}

/**
 * One boy, one fixture, and the three people who have a say.
 *
 * `state` is the resolved answer and the components stay beside it, because a
 * screen has to show which half said no: a restriction is the physio's to lift
 * and a family's answer is not the coach's to appeal. Nothing in this file
 * recomputes the state — the resolution happens in Postgres, where the scope
 * is, and a state invented here would be a fourth opinion.
 */
function asReadiness(r) {
  return { playerId: r.player_id, name: r.full_name, team: r.team_code,
           state: r.state,
           declaredStatus: r.declared_status, reasonKind: r.reason_kind,
           selfDeclared: r.self_declared === true,
           declaredByName: r.declared_by_name,
           // Tri-state, as above: true restricted, false cleared, null not asked.
           clinicallyRestricted: r.clinically_restricted ?? null,
           returnDate: r.rtw_date ? String(r.rtw_date).slice(0, 10) : null,
           selected: r.selected === true, side: r.selected_side, battingNo: r.batting_no,
           conflict: r.conflict, live: true };
}

/**
 * An appointment, with the person who made it named.
 *
 * granterName is null in two different situations and a screen has to tell
 * them apart: a row the platform seeded has no granter at all, and a row whose
 * granter this reader may not look up has one they cannot see. Both arrive as
 * null; granterId carries the id, so "granted by someone" and "granted by
 * nobody" stay distinguishable.
 *
 * Named granterId rather than grantedBy because rbac/index.js already exports
 * a grantedBy, and the import checker catches the collision — the same trap a
 * local named signedIn walked into earlier.
 */
/** One line of a school's record of who read what (db/08, db/20, db/22). */
function asAccessLog(r) {
  return { id: r.id, school: r.school_id, personId: r.person_id, personName: r.person_name ?? null,
           resource: r.resource, recordIds: r.record_ids ?? [], recordCount: r.record_count ?? 0,
           fields: r.fields ?? [], device: r.device_id ?? null, occurredAt: r.occurred_at,
           platformWide: r.platform_wide === true, supportAccessId: r.support_access_id ?? null, live: true };
}

/** A support session that reached a school: who, as what, why, for how long. */
function asSupportAccess(r) {
  return { id: r.id, actorId: r.actor_id, actorName: r.actor_name ?? null,
           school: r.school_id, schoolName: r.school_name ?? null, role: r.role, team: r.team_code ?? null,
           reason: r.reason, startedAt: r.started_at, expiresAt: r.expires_at, endedAt: r.ended_at ?? null,
           endedByName: r.ended_by_name ?? null, live: r.live === true, mine: r.mine === true };
}

function asAssignment(r) {
  return { id: r.id, personId: r.person_id, personName: r.person_name,
           role: r.role, school: r.school_id, team: r.team_code, fixture: r.fixture_id,
           active: r.active === true,
           validFrom: r.valid_from ? String(r.valid_from).slice(0, 10) : null,
           validUntil: r.valid_until ? String(r.valid_until).slice(0, 10) : null,
           grantedAt: r.created_at, granterId: r.created_by, granterName: r.granted_by_name,
           revokedAt: r.revoked_at, revokerId: r.revoked_by, revokerName: r.revoked_by_name,
           // Paused by the office (db/34): not live, but not revoked either.
           // authorize.mjs isActive() reads this beside `active`.
           suspended: r.suspended === true,
           live: true };
}

function asInjury(r) {
  return { id: r.id, player: r.player_id, type: r.injury_type, severity: r.severity,
           dateInj: r.date_injured, rtw: r.rtw_date, phase: r.phase,
           restricted: r.restricted, notes: r.notes, physio: r.physio, live: true };
}

/**
 * A data-quality gap dob_gaps() found: a boy with no birthday, or a guardian
 * link db/10 already had to end for lack of one. `kind` distinguishes them —
 * see the SQL for why they are one query rather than two: the second is
 * always a consequence of the first, and a screen answering "what is wrong
 * with this roster" wants both under one heading.
 */
function asDobGap(r) {
  return { kind: r.kind, playerId: r.player_id, name: r.full_name, team: r.team_code,
           school: r.school_id, linkId: r.link_id,
           guardianId: r.guardian_id, guardianName: r.guardian_name, guardianEmail: r.guardian_email,
           relationship: r.relationship,
           endedOn: r.ended_on ? String(r.ended_on).slice(0, 10) : null,
           live: true };
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

/**
 * A career line for ONE school season (SCRBRD-086): the same figures, derived
 * the same way, over the matches in that season. `season` is the label the
 * server filed the match under and `currentSeason` whether that is the season
 * today is in — both decided in Postgres (school_season_of(), db/44), so no
 * screen ever works out a season from a date or a clock. No form guide rides
 * along; it is an empty array, as for a player who has not batted.
 */
function asSeasonCareer(r) {
  return { ...asCareer(r), season: r.season ?? null, currentSeason: r.current_season === true };
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
/**
 * The dashboard's figures.
 *
 * `scopeMatches` and `scopePlayers` are carried through deliberately: a card
 * that says "9" should be able to say what the 9 was counted over. A partial
 * figure presented as a total is worse than an absent one, and two people
 * legitimately seeing different numbers for the same school is the model
 * working rather than a bug to explain away.
 *
 * `winRatePct` may be null — no matches played is not the same fact as having
 * lost them all, and a card must be able to tell the difference.
 */
function asSummary(r) {
  return {
    activePlayers:    r.active_players,
    injuriesActive:   r.injuries_active,
    unreadAlerts:     r.unread_alerts,
    sessionsThisWeek: r.sessions_this_week,
    upcomingMatches:  r.upcoming_matches,
    winRatePct:       r.win_rate_pct,
    nextMatchAt:      r.next_match_at,
    scopeMatches:     r.scope_matches,
    scopePlayers:     r.scope_players,
    // The viewer's own, null unless the account is linked to a player.
    myRuns:           r.my_runs,
    myBattingAverage: r.my_batting_average == null ? null : Number(r.my_batting_average),
    myStrikeRate:     r.my_strike_rate == null ? null : Number(r.my_strike_rate),
  };
}

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
  seasons: asSeason,
  competition_divisions: asDivision,
  weather: asWeather,
  news: asNewsPost,
  officials: asOfficial,
  duty_suspensions: asDutySuspension,
  official_register: asRegisteredOfficial,
  ground_conditions: asGroundCondition,
  assignments: asAssignment,
  access_log: asAccessLog,
  support_access: asSupportAccess,
  dob_gaps: asDobGap,
  vehicles: asVehicle,
  trips: asTrip,
  availability: asAvailability,
  readiness: asReadiness,
  emergency_contacts: asContact,
  trip_contacts: asContact,
  clearance_register: asClearance,
  clearances: asClearance,
  my_clearances: asClearance,
  clearance_requirements: asRequirement,
  role_requests: asRoleRequest,
  drills: asDrill,
  passport: asPassportLine,
  passport_consents: asPassportConsent,
  scouting_consent: asScoutingConsent,
  match_duties: asDuty,
  drs_reviews: asDrsReview,
  equipment: asEquipment,
  equipment_issues: asIssue,
  recognition: asRecognition,
  player_shot_points: asShotPoint,
  pitch_report: asPitchReport,
  caps: asCap,
  honours: asHonour,
  milestones: asMilestone,
  workload: asWorkload,
  bowling_spells: asSpell,
  bowling_breaches: asBreach,
  bowling_directives: asDirective,
  rulebook_clauses: asClause,
  roster_on: asRosterOn,
  my_devices: asDevice,
  memberships: asMembership,
  opposition_context: asOppositionContext,
  opposition_squad: asOppositionPlayer,
  phases: asPhases,
  derby_record: asDerby,
  matchups: asMatchup,
  matchup_coverage: asMatchupCoverage,
  sports: asSport,
  module_settings: asModuleSetting,
  module_suppressions: asModuleSuppression,
  my_features: asMyFeature,
  sponsors: asSponsor,
  sponsor_categories: asSponsorCategory,
  sponsorships: asSponsorship,
  injuries: asInjury,
  skills: asSkill,
  career: asCareer,
  career_by_season: asSeasonCareer,
  ratings: asRating,
  notes: asNote,
  dismissal_breakdown: asDismissalBreakdown,
  disciplinary_records: asMatter,
  // The dashboard's figures. One row, already scoped in Postgres — see the
  // `summary` query in read-api.mjs for why the counting happens there and not
  // here. The adapter only renames; it must never compute a figure the server
  // did not send, because a number invented in this file has no scope at all.
  summary: asSummary,
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

/**
 * One row of "how he's out" or "how he takes wickets", by method.
 *
 * `method` stays NULL rather than being coerced to a string here — db/26's
 * comment and the read API's are both explicit that a NULL dismissal is a
 * real wicket whose method was never recorded, not a row to drop, and the
 * view renders it as "Method not recorded" so a sum over this resource never
 * disagrees with the flat `career.dismissals` / `career.wickets` count.
 * `count` is coerced to a number because the column arrives as text over
 * JSON the way every other aggregate count in this file does.
 */
function asDismissalBreakdown(r) {
  return {
    playerId: r.player_id, name: r.full_name, team: r.team_code, school: r.school_id,
    side: r.side, method: r.dismissal, count: Number(r.count),
    live: true,
  };
}

/**
 * A disciplinary matter (SCRBRD-053). No mock twin, and there never should be:
 * an invented matter about a named child on a demo screen reads exactly like a
 * real one. Signed out, useLive() returns nothing for this resource because
 * rbac/ has no demo source for it.
 *
 * The recorder's NAME may arrive null — the reader can see the matter and not
 * the account of whoever filed it — and it is left null rather than defaulted,
 * so the screen says so instead of inventing somebody.
 */
function asMatter(r) {
  return {
    id: r.id, playerId: r.player_id, schoolId: r.school_id, matchId: r.match_id ?? null,
    body: r.body, state: r.state, outcome: r.outcome ?? null,
    occurredOn: r.occurred_on ? String(r.occurred_on).slice(0, 10) : null,
    recordedBy: r.recorded_by_name ?? null, recordedById: r.recorded_by,
    playerName: r.full_name ?? null, updatedAt: r.updated_at ?? null,
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
export function useLive(resource, role, nonce = 0, params = null) {
  const demo = !signedIn();
  // `params` narrows a read — one boy's recognition, one side's caps — and
  // is serialised into the effect's dependencies so a new object with the
  // same keys does not refetch, and a changed value does.
  const query = params && Object.keys(params).length
    ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString()
    : "";
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
        const { rows } = await api(`/api/read/${resource}${query}`);
        if (!cancelled) setState({ rows: rows.map(ADAPT[resource]), live: true, loading: false, error: null });
      } catch (e) {
        // Deliberately NOT falling back to mock. See above.
        //
        // A SWITCHED-OFF MODULE IS NOT A FAILURE, and reporting it as one is
        // how a setting becomes a support ticket. The API answers 403
        // module_disabled and names the module; that arrives here as
        // `disabled` with `error` left null, so every view that already draws
        // an empty state draws one — and a view that wants to say which module
        // is off has the key to say it with.
        //
        // `live: true` on this branch, deliberately: the server answered. This
        // is not a session that fell back to the demo fixture, and a screen
        // that said "sign in to see your school's data" here would be wrong.
        if (cancelled) return;
        if (e.status === 403 && e.code === "module_disabled") {
          setState({ rows: [], live: true, loading: false, error: null, disabled: resource });
          return;
        }
        setState({ rows: [], live: false, loading: false, error: e.code || "unreachable" });
      }
    })();
    return () => { cancelled = true; };
  }, [resource, role, nonce, query]);

  return state;
}

/**
 * The dashboard's figures, from the server in a live session.
 *
 * WHY THIS IS NOT useLive("summary", role)
 * ────────────────────────────────────────
 * useLive falls back to the client-side copy of authorize() when nobody is
 * signed in, which is right for row lists — the demo has to open on a laptop
 * with no backend. But a SUMMARY computed in the browser is the exact thing
 * the server-side query exists to replace, and the failure mode is silent: a
 * card showing a number counted from whatever rows happened to be in memory
 * looks identical to a card showing a number the database scoped.
 *
 * So the two paths are kept visibly apart. In a live session every figure
 * comes from Postgres and nothing here computes one. In the demo, the figures
 * are counted from the mock through the same client-side scoping the rest of
 * the demo uses, and `live: false` says so — a card can mark itself.
 *
 * `null` for the summary while loading or on failure, deliberately: a card
 * that renders 0 because a request failed has stated something false. Absent
 * is honest; zero is not.
 */
export function useSummary(role, nonce = 0) {
  const demo = !signedIn();
  const [state, setState] = useState(() =>
    demo ? { summary: demoSummary(role), live: false, loading: false, error: null }
         : { summary: null, live: false, loading: true, error: null });

  useEffect(() => {
    if (!signedIn()) {
      setState({ summary: demoSummary(role), live: false, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const { rows } = await api("/api/read/summary");
        const row = rows?.[0] ? asSummary(rows[0]) : null;
        if (!cancelled) setState({ summary: row, live: true, loading: false, error: null });
      } catch (e) {
        // No fallback to the demo figures. A signed-in person seeing numbers
        // counted in their own browser is the bug this replaced.
        if (!cancelled) setState({ summary: null, live: false, loading: false, error: e.code || "unreachable" });
      }
    })();
    return () => { cancelled = true; };
  }, [role, nonce]);

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
export function usePlayersWithCareer(role, nonce = 0) {
  const players = useRows("players", role, nonce);
  const career = useRows("career", role, nonce);
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

export function useRows(resource, role, nonce = 0) { return useLive(resource, role, nonce).rows; }

/**
 * Duty-roster coverage for several fixtures at once. SCRBRD-062.
 *
 * `useLive("match_duties", role, 0, { matchId })` already reads this
 * correctly for one fixture — the SLOTS union, "nothing on record" rather
 * than "pending" — from `duties.jsx`'s `DutyRoster`. This is the same read,
 * fanned out across the matches a sportsmaster actually wants to scan
 * together, not a new formula: each fixture's count comes from the identical
 * query and adapter, so it cannot read differently from what that fixture's
 * own DutyRoster shows.
 *
 * Returns `{ coverage, loading }`, where `coverage` is a
 * `Map<matchId, { rows, error }>` — `rows` in `asDuty` shape, ready for the
 * same `SLOTS`/`byDuty` grouping `DutyRoster` already does. A fixture whose
 * fetch failed gets its own `error` rather than being silently dropped from
 * the map, so a screen reading it can say which fixture would not load
 * rather than under-counting the whole board.
 */
export function useDutyCoverage(matchIds, role, nonce = 0) {
  const ids = matchIds.filter(Boolean);
  const key = ids.join(",");
  const [state, setState] = useState({ coverage: new Map(), loading: ids.length > 0 });

  useEffect(() => {
    if (!ids.length) { setState({ coverage: new Map(), loading: false }); return; }
    if (!signedIn()) {
      // No demo fixture is registered for match_duties (see getData()), so
      // every fixture reads as fully unrecorded — the same as DutyRoster
      // shows for any single match in a demo session.
      setState({ coverage: new Map(ids.map((id) => [id, { rows: [], error: null }])), loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      const entries = await Promise.all(ids.map(async (id) => {
        try {
          const { rows } = await api(`/api/read/match_duties?matchId=${encodeURIComponent(id)}`);
          return [id, { rows: rows.map(ADAPT.match_duties), error: null }];
        } catch (e) {
          return [id, { rows: [], error: e.code || "unreachable" }];
        }
      }));
      if (!cancelled) setState({ coverage: new Map(entries), loading: false });
    })();
    return () => { cancelled = true; };
  }, [key, role, nonce]);

  return state;
}

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
