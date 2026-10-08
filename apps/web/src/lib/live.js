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
import { combineReads } from "./readState.js";
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
    // The instant itself, for the scorer: it dates the match, and the date
    // decides the Edition of the Laws the match is scored under (SCRBRD-113).
    startsAt: r.starts_at ?? null,
    status: MATCH_STATUS[r.status] ?? "upcoming",
    result: null,
    competition: null,
    // The competition it is played under, or null for a friendly (SCRBRD-114):
    // the scorer's home asks whether its playing conditions are published.
    competitionId: r.competition_id ?? null,
    // The school season this fixture falls in, from the same season_for()
    // rule the calendar uses — never derived again here from the date, so a
    // season history view and the database can never name a fixture into two
    // different years.
    season: r.season ?? null,
    overs: r.overs,
    format: r.format,
    schoolId: r.school_id,
    // The away side's school, where it is a school on SCRBRD: a fixture between
    // two of one school's own teams is a scorebook's "both sides ours" (SCRBRD-120).
    awaySchoolId: r.away_school_id ?? null,
    // Both sides named in full ("Hilton College 1XI"), and each side's short
    // code where this reader's read returns one (school.code) — the Match
    // Centre names a side in full where there is room and by code where not
    // (lib/matchCentre.js sidesOf). The away side's label is null for an
    // opponent that is not on SCRBRD; `awayTeam` (the free text) stands then.
    homeLabel: r.home_label ?? null,
    awayLabel: r.away_label ?? null,
    homeCode: r.home_code ?? null,
    awayCode: r.away_code ?? null,
    awayTeamCode: r.away_team_code ?? null,
    // The toss as the fixture read carries it: 'home' | 'away', 'bat' | 'bowl'.
    tossWonBy: r.toss_won_by ?? null,
    tossDecision: r.toss_decision ?? null,
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
    // The two the family's own record screen draws (step 4 P7b, S4): masked
    // per row like every column here — null means "not yours to read".
    address: r.address ?? null,
    idNumber: r.id_number ?? null,
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
           type: r.surface, available: true, live: true,
           // The field a pitch lies on, and the strip's two named ends (db/67),
           // for the ground owner's fixture-slot panel (views/groundoffers.jsx).
           parentId: r.parent_id ?? null, endA: r.end_a_name ?? null, endB: r.end_b_name ?? null };
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
    // What the notice is about (SCRBRD-137 S12): a fixture, say, by its id. The
    // cockpit's notices lane shows only those about the match it is open on.
    subjectKind: r.subject_kind ?? null, subjectId: r.subject_id ?? null,
    // The child a notice is about, when it is about one (step 4 P1/P5): a
    // family screen says whose it is, and a parent who is also staff sees on
    // a child's Home only the notices about that child or about nobody.
    subjectPerson: r.subject_person_id ?? null,
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
           noResult: r.no_result, points: r.points == null ? null : Number(r.points),
           nrr: r.net_run_rate == null ? null : Number(r.net_run_rate),
           // SCRBRD-114 phase 3a: the table is computed (db/69) where the
           // league's points are confirmed, else typed; its rank, shared on a tie.
           ties: r.tied ?? 0, basis: r.basis ?? null, rank: r.rank ?? null,
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

/**
 * A recorded observation, for one fixture (match_weather). `observedAt` is the
 * time the scorer took it, which this adapter used to drop (GA-I18): without it
 * a reading from yesterday reads as this morning's. Null when the row has none.
 * Nothing here is the provider's hint; that is lib/weatherHint.js.
 */
export function asWeather(r) {
  return { matchId: r.match_id, condition: r.condition, tempC: r.temp_c,
           humidity: r.humidity_pct, windKph: r.wind_kph, windDir: r.wind_dir,
           uvIndex: r.uv_index, rainChancePct: r.rain_chance_pct,
           forecast: r.forecast, playable: r.playable,
           observedAt: r.observed_at == null ? null : String(r.observed_at), live: true };
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
    // The public home page (SCRBRD-142 §3.5, db/83). `publicState` is null
    // (never asked, or not this reader's to know), "requested", "approved",
    // "edited" (approved, then changed: off the home page) or "withdrawn".
    mine: r.mine === true,
    mayApprove: r.may_approve === true,
    mayTakeDown: r.may_take_down === true,
    publicState: r.public_state ?? null,
    publicNames: r.public_names == null ? null : Number(r.public_names),
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

/**
 * One boy's answer about one fixture, and null status means he has not answered.
 *
 * `status` is the server's EFFECTIVE status (SCRBRD-122, db/65):
 * "needs_reconfirming" when the fixture has moved since the answer was given,
 * which counts as no answer. `saidStatus` is what was said and `wasLine` what
 * it was said about; `fixtureWords` is the fixture now, on the same clock.
 */
function asAvailability(r) {
  return { playerId: r.player_id, name: r.full_name, team: r.team_code,
           status: r.status, saidStatus: r.said_status ?? null,
           needsReconfirming: r.needs_reconfirming === true,
           wasLine: r.was_line ?? null, fixtureWords: r.fixture_words ?? null,
           reasonKind: r.reason_kind, note: r.note,
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
           // SCRBRD-136 (the coach's cockpit): the week's load as the server's WORD and whether a
           // training band is inside the figure. The ratio behind the word (ewma_ratio) is
           // deliberately not carried here: the cockpit draws the word, never the number (D7).
           loadWord: r.load_word ?? null, estimated7d: r.estimated_7d === true,
           live: true };
}
/**
 * One bowler's load (SCRBRD-110, db/60's load_summary). Every figure and the
 * word are the server's; the screen draws them and says "estimate" where
 * `estimated*` is true.
 */
function asLoad(r) {
  const n = (v) => (v == null ? null : Number(v));
  return { playerId: r.player_id, sport: r.sport_code, onDate: r.on_date ? String(r.on_date).slice(0, 10) : null,
           units7d: r.units_7d, units14d: r.units_14d, units28d: r.units_28d, units42d: r.units_42d,
           matchUnits7d: r.match_units_7d, matchUnits28d: r.match_units_28d,
           estimated7d: r.estimated_7d, estimated14d: r.estimated_14d, estimated28d: r.estimated_28d, estimated42d: r.estimated_42d,
           unitsPrev7d: r.units_prev_7d, weekChangePct: n(r.week_change_pct),
           ewmaRatio: n(r.ewma_ratio), loadWord: r.load_word, ratioEstimated: r.ratio_estimated,
           uncoupledRatio: n(r.uncoupled_ratio),
           daysSinceBowled: r.days_since_bowled, longestGap42d: r.longest_gap_42d, usualGap28d: n(r.usual_gap_28d),
           baselineWeek: n(r.baseline_week), baselineWeeksNeeded: r.baseline_weeks_needed,
           baselineDeviation: n(r.baseline_deviation), baselineWord: r.baseline_word,
           possiblyDoubled7d: r.possibly_doubled_7d, monitored: r.monitored, live: true };
}
/** One ISO week of his load, for the chart. */
function asLoadWeek(r) {
  const n = (v) => (v == null ? null : Number(v));
  return { weekStart: String(r.week_start).slice(0, 10), weekEnd: String(r.week_end).slice(0, 10),
           units: r.units, matchUnits: r.match_units, enteredUnits: r.entered_units, estimated: r.estimated,
           sessions: r.sessions, minutes: r.minutes, au: r.au, mean13w: n(r.mean_13w), mean26w: n(r.mean_26w), live: true };
}
/**
 * One consent a family (or the athlete himself) answers for. The server says
 * who gave it only as "you", "the office" (a form) or the other side, and
 * never names a guardian.
 */
function asConsent(r) {
  const d = (v) => (v ? String(v).slice(0, 10) : null);
  return { kind: r.kind, playerId: r.player_id, name: r.full_name, relation: r.relation, adult: r.adult,
           live: r.live, state: r.state, givenBy: r.given_by, byYou: r.by_you, fromForm: r.from_form,
           givenOn: d(r.given_on), endedOn: d(r.ended_on), version: r.version,
           canSayYes: r.can_say_yes, canSayNo: r.can_say_no, parentSaidYes: r.parent_said_yes,
           askAt18: r.ask_at_18, retentionDue: d(r.retention_due),
           // Whether workload_monitoring is on for THIS CHILD'S school
           // (SCRBRD-110 §9.1, Decided 2). Screens hide the toggle, the
           // one-time card and the eighteen card when this is false;
           // `!== false` below treats an older/missing value as on, never off.
           moduleOn: r.module_on };
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
           // The match's own start (SCRBRD-102): the query already joins
           // match for it (starts_at orders the career read), so a match
           // filter can label its options by date without a second read.
           matchId: r.match_id, startsAt: r.starts_at ?? null,
           innings: r.innings, seq: r.seq, live: true };
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
           isPublic: r.is_public, awardedBy: r.awarded_by_name,
           // The read returns live honours only (withdrawn_at is null); the
           // captain's gate (lib/captain.js) checks it again, so a read that
           // ever returned a withdrawn row could not switch the view on.
           withdrawnAt: r.withdrawn_at ?? null, live: true };
}
function asMilestone(r) {
  return { playerId: r.player_id, name: r.full_name, team: r.team_code, kind: r.kind, label: r.label, value: r.value,
           matchId: r.match_id, innings: r.innings, opponent: r.opponent, on: d10(r.played_on), live: true };
}
function asRoleRequest(r) {
  return { id: r.id, personId: r.person_id, name: r.name, email: r.email, role: r.role, school: r.school_id,
           schoolName: r.school_name, team: r.team_code, playerId: r.player_id, note: r.note, state: r.state,
           requestedAt: r.requested_at, decidedAt: r.decided_at, decidedNote: r.decided_note, decidedBy: r.decided_by_name,
           mine: r.mine === true, decidable: r.decidable === true, askedUnverified: r.asked_unverified === true, live: true };
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
           // The scoring row only: whose the token is, for this reader
           // (this_device, you, another, lapsed), worked out by the server
           // against the reader's own token (GA-I13). Null everywhere else.
           held: r.held ?? null,
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
           // Effective, as the availability read's `status` (SCRBRD-122);
           // what was said is saidStatus.
           declaredStatus: r.declared_status, saidStatus: r.said_status ?? null,
           needsReconfirming: r.needs_reconfirming === true,
           reasonKind: r.reason_kind,
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

/**
 * One child the signed-in guardian answers for (step 4 G1), from her own live
 * link. `until` is the link's own end date (G11): null while the child is at
 * school (db/62), a date otherwise. Never derived from a birthday here.
 */
function asChild(r) {
  return { id: r.player_id, name: r.full_name, knownAs: r.known_as ?? null, team: r.team_code,
           school: r.school_id, schoolName: r.school_name ?? null, schoolKind: r.school_kind ?? null,
           relationship: r.relationship, verification: r.verification_state, consent: r.consent_state,
           from: d10(r.valid_from), until: d10(r.valid_until), live: true };
}

/** One name on a fixture's team sheet, as the reader's policy returns it. */
function asSquadLine(r) {
  return { matchId: r.match_id, playerId: r.player_id, side: r.side, battingNo: r.batting_no ?? null,
           twelfth: r.twelfth === true, name: r.full_name, live: true };
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
export function asCareer(r) {
  const runs = Number(r.runs);
  // A figure the scorebook did not record is NULL and stays null here
  // (SCRBRD-120 D12): 0 is a fact, and a screen that divides by a null-as-zero
  // overstates a strike rate. Only a player with no batting row reads 0.
  const opt = (v) => (v == null ? null : Number(v));
  const balls = opt(r.balls_faced);
  const outs = Number(r.dismissals);
  const conceded = Number(r.runs_conceded), bowled = Number(r.balls_bowled);
  const wkts = Number(r.wickets);
  const round2 = (n) => Math.round(n * 100) / 100;
  const runsWithoutBalls = Number(r.runs_without_balls ?? 0);
  return {
    id: r.player_id,
    name: r.full_name,
    team: r.team_code,
    school: r.school_id,
    innings: Number(r.bat_matches),
    runs, ballsFaced: balls, fours: opt(r.fours), sixes: opt(r.sixes),
    // How partial the record is (player_unrecorded_figures, summed by the
    // read): a boundary count is "at least" when an innings did not record one.
    bookInnings: Number(r.book_innings ?? 0),
    inningsWithoutBalls: Number(r.innings_without_balls ?? 0),
    runsWithoutBalls,
    inningsWithoutBoundaries: Number(r.innings_without_boundaries ?? 0),
    bowlingWithoutExtras: Number(r.bowling_without_extras ?? 0),
    wides: opt(r.wides), noBalls: opt(r.no_balls),
    dismissals: outs,
    avg: outs > 0 ? round2(runs / outs) : null,
    // Over the innings whose balls are recorded: runs less the runs made in
    // innings with no balls column. Null when no ball is recorded at all.
    sr: balls > 0 ? round2(((runs - runsWithoutBalls) * 100) / balls) : null,
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
  // Every account, disabled ones included: People's read (account lifecycle D5).
  accounts: asUser,
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
  // SCRBRD-140: no mock twin, and never one (an invented sign-in reads like a real one). Rows stay as the read returns them.
  my_sign_ins: (r) => r,
  sign_in_claims: (r) => r,
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
  load: asLoad,
  load_weeks: asLoadWeek,
  consents: asConsent,
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
  my_children: asChild,
  match_squad: asSquadLine,
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

/**
 * The query string a read carries. One function for useLive() and readLive(), so
 * a retry that bumps the nonce asks the SAME question: the same params, the same
 * scope, never a wider read and never one with a param dropped.
 * @param {Record<string, string | number | null | undefined> | null | undefined} params
 */
export function readQuery(params) {
  const q = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString() : "";
  return q ? `?${q}` : "";
}

/** Resources the client knows how to read live. Used by the wiring tests. */
export function liveResources() { return Object.keys(ADAPT); }

/**
 * One read of one resource, as the state useLive() holds it. The effect below
 * is a call to this, and a retry is the same call again: the effect's
 * dependencies are [resource, role, nonce, query], so bumping `nonce` re-runs it
 * with the same resource and the same query, and nothing a retry does can ask
 * for more than the first read did. Exported so the suites can run it.
 *
 * Deliberately NOT falling back to mock. See useLive().
 *
 * A SWITCHED-OFF MODULE IS NOT A FAILURE, and reporting it as one is how a
 * setting becomes a support ticket. The API answers 403 module_disabled and
 * names the module; that arrives here as `disabled` with `error` left null, so
 * every view that already draws an empty state draws one, and a view that
 * wants to say which module is off has the key to say it with.
 *
 * `live: true` on that branch, deliberately: the server answered. This is not a
 * session that fell back to the demo fixture, and a screen that said "sign in
 * to see your school's data" here would be wrong.
 *
 * `status` is the refusal's HTTP status, kept so a screen can tell "you may
 * not" (403) from "it did not work" (a 5xx, a timeout: no status at all)
 * without guessing from the code. lib/readState.js decides.
 * @param {string} resource  @param {string} [query]  the string readQuery() made
 */
export async function readOnce(resource, query = "") {
  try {
    const { rows } = await api(`/api/read/${resource}${query}`);
    return { rows: rows.map(ADAPT[resource]), live: true, loading: false, error: null, status: null };
  } catch (/** @type {any} */ e) {
    if (e.status === 403 && e.code === "module_disabled") {
      return { rows: [], live: true, loading: false, error: null, status: 403, disabled: resource };
    }
    return { rows: [], live: false, loading: false, error: e.code || "unreachable", status: e.status ?? null };
  }
}

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
 * Returns { rows, live, loading, error, status } (and `disabled` for a module
 * switched off) so a view can tell the states apart; lib/readState.js turns them
 * into the nine a screen draws. `loading` matters: an empty array during the first fetch is not the
 * same statement as an empty array after it, and "no fixtures today" is a
 * claim the UI should only make once the server has actually said so.
 */
export function useLive(resource, role, nonce = 0, params = null) {
  const demo = !signedIn();
  // `params` narrows a read — one boy's recognition, one side's caps — and
  // is serialised into the effect's dependencies so a new object with the
  // same keys does not refetch, and a changed value does.
  const query = readQuery(params);
  const [state, setState] = useState(() =>
    demo
      ? { rows: scoped(resource, role), live: false, loading: false, error: null, status: null }
      : { rows: [], live: false, loading: true, error: null, status: null });

  useEffect(() => {
    if (!signedIn()) {
      setState({ rows: scoped(resource, role), live: false, loading: false, error: null, status: null });
      return;
    }
    if (!ADAPT[resource]) {
      setState({ rows: [], live: false, loading: false, error: "no_adapter", status: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    readOnce(resource, query).then((next) => { if (!cancelled) setState(next); });
    return () => { cancelled = true; };
  }, [resource, role, nonce, query]);

  return state;
}

/**
 * One read, mapped by the same adapter useLive() uses, for code that reads
 * several resources at once and cannot call a hook for each (the coach's
 * cockpit, SCRBRD-136). Signed out, or on any failure, it returns null: the
 * caller then knows the read did not answer, which is not the same as the read
 * answering with nothing — a rule over a read that failed must not fire.
 * @param {string} resource  @param {Record<string, string> | null} [params]
 * @returns {Promise<any[] | null>}
 */
export async function readLive(resource, params = null) {
  if (!signedIn() || !ADAPT[resource]) return null;
  const query = readQuery(params);
  try {
    const { rows } = await api(`/api/read/${resource}${query}`);
    return (rows ?? []).map(ADAPT[resource]);
  } catch { return null; }
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
  const read = useLive("skills", role, nonce);
  const { rows, live, loading, error, status, disabled } = read;
  // Demo: the seeded matrix, and nothing to say about a read that never ran.
  if (!signedIn()) return { skills: scopedSkills(role), live: false, loading: false, error: null, status: null, disabled: null, rows: [] };
  const skills = {};
  const seen = new Set();
  // Rows arrive newest first (assessed_on desc), so the first one wins.
  for (const r of rows) {
    const key = `${r.playerId}:${r.category}:${r.metric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (skills[r.playerId] ??= {})[r.category] ??= {};
    skills[r.playerId][r.category][r.metric] = r.score;
  }
  // `skills` is the pivot the screens index by player id; the rest is the
  // read's own state. This used to return the pivot alone and `void` the state,
  // so a failed read drew as "no assessments" and a slow one as nothing (audit
  // R15). `rows` is the read's, for lib/readState.js: a player with no key in
  // `skills` is `unassessed`, which is not a zero and not an empty radar.
  return { skills, rows, live, loading, error, status, disabled: disabled ?? null };
}

/**
 * Weather, keyed by match id — the shape the fixture screens index into — with
 * the state of the read beside it. `useWeather` keeps its old shape for the
 * callers that only want the map; a screen that must tell a read that failed
 * from a fixture with no reading calls this.
 */
export function useWeatherState(role, nonce = 0) {
  const { rows, live, loading, error, status, disabled } = useLive("weather", role, nonce);
  if (!signedIn()) return { weather: scopedWeather(role), live: false, loading: false, error: null, status: null, disabled: null, rows: [] };
  return { weather: Object.fromEntries(rows.map((w) => [w.matchId, w])), rows, live, loading, error, status, disabled: disabled ?? null };
}

/** Weather, keyed by match id. The map alone: see useWeatherState() for the read's state. */
export function useWeather(role, nonce = 0) {
  return useWeatherState(role, nonce).weather;
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
  return usePlayersWithCareerState(role, nonce).rows;
}

/**
 * The same rows, with the state of both reads beside them — for a screen
 * whose whole content IS the figures (the Awards tab), where a read that
 * failed or timed out must be said, not drawn as lists nobody is on. `rows`
 * is exactly usePlayersWithCareer()'s; `players` and `career` are each read's
 * { loading, error }, so the screen can tell "still coming", "could not be
 * read" and "nobody has played" apart.
 */
export function usePlayersWithCareerState(role, nonce = 0) {
  const players = useLive("players", role, nonce);
  const career = useLive("career", role, nonce);
  const byId = new Map(career.rows.map((c) => [c.id, c]));
  const rows = !career.rows.length ? players.rows : players.rows.map((p) => {
    const c = byId.get(p.id);
    return c ? { ...p, ...c, name: p.name ?? c.name } : p;
  });
  return {
    rows,
    // Each read's whole state (rows, status, disabled), for lib/readState.js:
    // `{ loading, error }` alone could not tell a role that may not read
    // career figures from a read that failed.
    players: { loading: players.loading, error: players.error, status: players.status ?? null, disabled: players.disabled ?? null, rows: players.rows, live: players.live },
    career: { loading: career.loading, error: career.error, status: career.status ?? null, disabled: career.disabled ?? null, rows: career.rows, live: career.live },
    // The two reads as ONE statement (lib/readState.js): `partial` when the
    // career read failed while players are present, so a screen ranks nothing
    // from players who merely lack their figures. `rows` above is unchanged.
    read: combineReads([{ what: "the players", read: players }, { what: "the career figures", read: career }]),
  };
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
  const { rows, live, loading, error, status, disabled } = useLive("ratings", role, nonce);
  const byPlayer = {};
  for (const r of rows) byPlayer[r.id] = r;
  return { ratings: byPlayer, rows, live, loading, error, status, disabled: disabled ?? null };
}

/**
 * Notes for one player, newest first.
 *
 * No mock fallback: a development note is a named coach's writing about a named
 * child, and a fabricated one on a demo screen would read exactly like a real
 * one. Signed out this is empty.
 */
export function useNotes(role, playerId, nonce = 0) {
  const { rows, live, loading, error, status, disabled } = useLive("notes", role, nonce);
  return { notes: rows.filter((n) => !playerId || n.playerId === playerId), rows, live, loading, error, status, disabled: disabled ?? null };
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
