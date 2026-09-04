/**
 * SCRBRD — what a team is called, and why the name carries meaning.
 *
 * A team code is not a label. It is a SCOPE ANCHOR: `app_can()` compares it for
 * equality on every authorization decision, an assignment is scoped by it, and
 * an injury's readability is derived from the one on the player's row. So the
 * vocabulary has to be closed and the comparisons have to be exact.
 *
 * THE AGE MODEL, CORRECTED
 * ────────────────────────
 * South African schools run U9 through U16, where "U14" means fourteen and
 * under. Above that there is no U17, U18 or U19 — those players are in the
 * OPEN age category, and open teams are named by rank: 1st XI, 2nd XI, 3rd XI.
 *
 * This codebase had U19A everywhere, in the seed and in nineteen views, and it
 * was simply wrong about the sport. A first-team schoolboy side is the 1st XI.
 *
 * REPRESENTATIVE CRICKET IS DIFFERENT
 * ───────────────────────────────────
 * Provincial and national cricket DOES field U19 sides, selected on age rather
 * than on which school team a boy plays for. So the age bands are a property of
 * the LEVEL, not of the platform: U19 is invalid for a school team and valid
 * for a provincial one. A player in a school's 1st XI can be selected for a
 * provincial U19 side in the same season, and both facts have to be
 * representable at once.
 *
 * That is also the hinge for what comes next. SCRBRD is intended to follow a
 * career from school through club to representative cricket, which means a
 * player's teams accumulate across levels rather than replacing one another —
 * so `level` belongs on the team from the start, even while only `school`
 * exists.
 */

/** Where a team sits. Only `school` is populated today; the rest are the path. */
export const LEVELS = Object.freeze(["school", "club", "provincial", "national"]);

/**
 * Age bands, by level.
 *
 * A school stops at U16 and everything above is open. A club runs the same
 * junior bands and its own open sides. Representative cricket adds U17-U19,
 * which is exactly the band schools do NOT have — selected on age, not on
 * which XI a boy happens to be in.
 */
export const AGE_GROUPS = Object.freeze({
  school:     Object.freeze([9, 10, 11, 12, 13, 14, 15, 16]),
  club:       Object.freeze([9, 10, 11, 12, 13, 14, 15, 16]),
  provincial: Object.freeze([13, 14, 15, 16, 17, 18, 19]),
  national:   Object.freeze([15, 16, 17, 18, 19]),
});

/** Divisions within an age group: U14A, U14B, U14C… */
const DIVISION = /^[A-F]$/;

/**
 * Codes are terse and space-free; LABELS carry the convention.
 *
 * The convention is "1st XI", with a space. A scope anchor compared for
 * equality across a database, an API, a CSV export and — once SCRBRD reaches
 * club and provincial cricket — someone else's federation feed, is better
 * without one. So the code is `1XI` and `teamLabel()` renders "1st XI".
 *
 * Age-group codes need no such split: U14A is already both.
 */
const OPEN_CODE = /^(\d{1,2})XI$/;
const AGE_CODE = /^U(\d{1,2})([A-F]?)$/;

const ORDINAL = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/**
 * Parse a team code into what it means.
 *
 * @returns {{kind:"age"|"open", age:number|null, division:string|null,
 *            rank:number|null, code:string}} or null when the code is not one.
 */
export function parseTeam(code) {
  if (typeof code !== "string") return null;
  const trimmed = code.trim();
  if (!trimmed) return null;

  const open = OPEN_CODE.exec(trimmed);
  if (open) {
    const rank = Number(open[1]);
    if (rank < 1 || rank > 20) return null;
    return { kind: "open", age: null, division: null, rank, code: trimmed };
  }

  const age = AGE_CODE.exec(trimmed);
  if (age) {
    const years = Number(age[1]);
    const division = age[2] || null;
    if (division && !DIVISION.test(division)) return null;
    return { kind: "age", age: years, division, rank: null, code: trimmed };
  }
  return null;
}

/** Is this a team code a given level may field? */
export function isValidTeam(code, level = "school") {
  const t = parseTeam(code);
  if (!t) return false;
  if (t.kind === "open") return level === "school" || level === "club";
  const bands = AGE_GROUPS[level];
  return Array.isArray(bands) && bands.includes(t.age);
}

/** "U14B" → "U14B";  "1XI" → "1st XI". */
export function teamLabel(code) {
  const t = parseTeam(code);
  if (!t) return code ?? "";
  return t.kind === "open" ? `${ORDINAL(t.rank)} XI` : t.code;
}

/**
 * Sort order: seniority first, then division.
 *
 * Open teams are the senior end, so they sort ahead of every age group, with
 * the 1st XI first. Age groups descend — U16 before U9 — because that is the
 * order a team sheet, a fixture list and a squad picker are read in.
 */
export function compareTeams(a, b) {
  const A = parseTeam(a), B = parseTeam(b);
  if (!A && !B) return String(a).localeCompare(String(b));
  if (!A) return 1;
  if (!B) return -1;
  if (A.kind !== B.kind) return A.kind === "open" ? -1 : 1;
  if (A.kind === "open") return A.rank - B.rank;
  if (A.age !== B.age) return B.age - A.age;
  return String(A.division ?? "").localeCompare(String(B.division ?? ""));
}

/**
 * The date an age is measured on. CONFIRMED CONVENTION, not an assumption.
 *
 * Age-group eligibility is judged as at 1 JANUARY of the season, not on the
 * day of the match. A boy who turns 14 in March plays the whole season in the
 * band he was in on 1 January — otherwise a side is legal in February and
 * illegal in April, and a player changes age group mid-season.
 *
 * WHICH 1 JANUARY DEPENDS ON THE LEVEL, AND THAT IS THE WHOLE SUBTLETY
 * ───────────────────────────────────────────────────────────────────
 * The two halves of South African cricket keep time differently:
 *
 *   SCHOOL — the school year IS the calendar year. Four terms, January to
 *     December, cricket in TERM 1 (Jan–Mar) and TERM 4 (Oct–Dec) of the same
 *     one. Both cricket terms sit inside one January-to-December window, so
 *     the season is named for a single year and the cut-off is the 1 January
 *     that opens it.
 *
 *   CLUB, PROVINCIAL, NATIONAL — the season is the SOUTHERN SUMMER and is
 *     named for two: the 2025/26 season, spring through autumn. Winter is
 *     given over to northern-hemisphere tours and county cricket. Such a
 *     season contains exactly one 1 January — the one in its second year — and
 *     that is the cut-off.
 *
 * Apply the school rule to a club season and every player computes a year
 * young from September to December, so a fourteen-year-old passes an under-13
 * check in October. Apply the club rule to a school season and a boy changes
 * band between Term 1 and Term 4 of the same school year. Neither is a
 * rounding difference; both put the wrong child on the field.
 *
 * WHICH 1 JANUARY, FOR A SEASON NAMED FOR TWO YEARS — a reading, not a
 * confirmed rule. "2025/26" is taken to end in 2026, so the cut-off is 1
 * January 2026: the one that falls INSIDE the season. It is also the stricter
 * of the two candidate readings — players compute a year older than they would
 * against the preceding January — which is the right direction for a boundary
 * that exists to stop an older child playing down. If a union states
 * otherwise, SEASON_END_OFFSET below is the line to change.
 *
 * The eligibility trigger in db/08_schema_programme.sql derives its date the
 * same way and today assumes SCHOOL, because every fixture in the schema
 * belongs to a school; it refuses a band a school does not field rather than
 * quietly answering for a level it cannot see. Change both together. Pinned by
 * packages/policy/test/teams.test.mjs group F2, which fails if the cut-off
 * moves, if a school season is treated as straddling, or if a club season is
 * not.
 */
export const CUTOFF_MONTH = 1;
export const CUTOFF_DAY = 1;

/**
 * Whether a level's season crosses the new year, and so is named for two.
 *
 * School cricket does not: it is bounded by a school year that is a calendar
 * year. Everything above it does: the season is the southern summer, spring to
 * autumn, and is spoken as "2025/26".
 */
export const SEASON_SPANS_NEW_YEAR = Object.freeze({
  school: false, club: true, provincial: true, national: true,
});

/**
 * The month a straddling season is deemed to begin in.
 *
 * July, which is midwinter here and the one part of the year southern
 * hemisphere cricket is NOT played — the months given over to northern tours
 * and county cricket. A boundary placed in the off-season cannot fall inside a
 * fixture list, so no season is ever split by it.
 */
export const SEASON_START_MONTH = 7;

/** For a season named for two years, the cut-off is in the second. */
const SEASON_END_OFFSET = 1;

/**
 * The year whose 1 January governs a match played on this date at this level.
 *
 * For school, the year of the match: the school year is the calendar year.
 * For every other level, the year the SEASON ENDS — so a fixture in October
 * 2025 and one in February 2026 are the same 2025/26 season and answer to the
 * same 1 January 2026.
 */
export function seasonYearFor(onDate, level = "school") {
  const ref = onDate instanceof Date ? onDate : new Date(onDate);
  if (Number.isNaN(ref.getTime())) return null;
  const year = ref.getUTCFullYear();
  if (!SEASON_SPANS_NEW_YEAR[level]) return year;
  return ref.getUTCMonth() + 1 >= SEASON_START_MONTH ? year + SEASON_END_OFFSET : year;
}

/**
 * How a season is written down, which differs by level for the same reason.
 *
 * `season` is a scope anchor on role_assignment, compared for equality, so the
 * two vocabularies must not be invented twice — "2026" for a school and
 * "2025/26" for a club are both correct and are not interchangeable.
 */
export function seasonLabel(onDate, level = "school") {
  const end = seasonYearFor(onDate, level);
  if (end == null) return null;
  if (!SEASON_SPANS_NEW_YEAR[level]) return String(end);
  return `${end - SEASON_END_OFFSET}/${String(end % 100).padStart(2, "0")}`;
}

/** The cut-off date for a season, as a Date. Takes the year, not a level. */
export function cutoffFor(seasonYear) {
  return new Date(Date.UTC(seasonYear, CUTOFF_MONTH - 1, CUTOFF_DAY));
}

/**
 * A player's age on the cut-off date of the season a match falls in, which
 * depends on the LEVEL — see CUTOFF_MONTH above.
 *
 * Returns null when the date of birth is unknown — which is a real state, not
 * an edge case: `born` is masked behind player.age.read, so a caller without
 * it receives NULL and must not be handed an eligibility answer computed from
 * nothing.
 */
export function ageAtCutoff(born, onDate = new Date(), level = "school") {
  if (!born) return null;
  const b = born instanceof Date ? born : new Date(born);
  if (Number.isNaN(b.getTime())) return null;
  const ref = onDate instanceof Date ? onDate : new Date(onDate);
  if (Number.isNaN(ref.getTime())) return null;
  const seasonYear = seasonYearFor(ref, level);
  if (seasonYear == null) return null;
  const cut = cutoffFor(seasonYear);
  let age = cut.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday =
    cut.getUTCMonth() < b.getUTCMonth() ||
    (cut.getUTCMonth() === b.getUTCMonth() && cut.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Is a player of this age eligible for this team?
 *
 * "U14" means fourteen and under, so eligibility is an upper bound and there is
 * no lower one — a gifted twelve-year-old plays U14, and that is normal.
 * An open team has no age limit at all.
 *
 * Returns null when the age is unknown rather than guessing, because
 * `player.born` is masked behind player.pii.read and a caller who may not read
 * a date of birth must not be handed an eligibility answer derived from it.
 */
export function isEligible(age, code) {
  const t = parseTeam(code);
  if (!t) return null;
  if (age == null || !Number.isFinite(age)) return null;
  return t.kind === "open" ? true : age <= t.age;
}

/**
 * The side a player moves to when they age out of this one — at the SAME MERIT
 * LEVEL, which is the part that matters.
 *
 * A boy in the U13A side is not a U14 player in general; he is one of the best
 * thirteen-year-olds at the school, and the side he should be trialled for is
 * the U14A. Promoting him to U14C because that is where a space happens to be
 * is how a good player is lost. So the division letter is preserved.
 *
 * The one place that breaks down is the top of the age groups. A U16 ages into
 * the OPEN category, where sides are ranked rather than lettered, and a U16A is
 * not automatically a 1st XI candidate — he is competing with seventeen- and
 * eighteen-year-olds for the first time. There is no honest letter-to-rank
 * mapping, so this returns EVERY open side and lets the coaches sort it out,
 * which is what actually happens in a school.
 *
 * @returns {string[]} candidate team codes, or [] when there is no step up.
 */
export function nextBandUp(code, { openSides = 3 } = {}) {
  const t = parseTeam(code);
  if (!t || t.kind === "open") return [];          // an open side is the top
  const bands = AGE_GROUPS.school;
  const i = bands.indexOf(t.age);
  if (i === -1) return [];
  if (i === bands.length - 1) {
    return Array.from({ length: openSides }, (_, r) => `${r + 1}XI`);
  }
  return [`U${bands[i + 1]}${t.division ?? ""}`];
}

/**
 * Will this player's band change at the next cut-off, and on which birthday?
 *
 * A boy of 13 in a U13 side who turns 14 before the next 1 January is a U14
 * player next season. He stays eligible for the rest of THIS one — that is the
 * whole point of the 1 January rule — which is exactly why the notice has to go
 * out ahead of the birthday rather than when he becomes ineligible. By the time
 * he is ineligible, the trials have happened.
 *
 * @returns {{birthday:Date, currentBand:number, nextBand:number}|null}
 */
export function bandChangeAhead(born, team, from = new Date()) {
  const t = parseTeam(team);
  if (!t || t.kind === "open" || !born) return null;
  const b = born instanceof Date ? born : new Date(born);
  if (Number.isNaN(b.getTime())) return null;
  const ref = from instanceof Date ? from : new Date(from);

  let year = ref.getUTCFullYear();
  let birthday = new Date(Date.UTC(year, b.getUTCMonth(), b.getUTCDate()));
  if (birthday < ref) birthday = new Date(Date.UTC(++year, b.getUTCMonth(), b.getUTCDate()));

  // Their band at the cut-off AFTER that birthday. If it exceeds the side they
  // are in, they age out of it for the coming season.
  // "school" stated rather than defaulted: this notice is a school-roster
  // feature, and a silent default is how it would follow a change made for
  // club cricket into a place that must not move.
  const after = ageAtCutoff(b, new Date(Date.UTC(birthday.getUTCFullYear() + 1, 5, 1)), "school");
  if (after == null || after <= t.age) return null;
  return { birthday, currentBand: t.age, nextBand: after };
}

/** How far ahead a coach is told. Thirty days, per the product rule. */
export const BAND_CHANGE_NOTICE_DAYS = 30;

/** Every code a level may legitimately field, in reading order. */
export function teamsForLevel(level = "school", { divisions = ["A", "B", "C"], openSides = 3 } = {}) {
  const out = [];
  if (level === "school" || level === "club")
    for (let r = 1; r <= openSides; r++) out.push(`${r}XI`);
  for (const age of [...(AGE_GROUPS[level] ?? [])].sort((a, b) => b - a))
    for (const d of divisions) out.push(`U${age}${d}`);
  return out;
}

/**
 * Pull a team code out of a display name — "Hilton 1st XI" → "1XI".
 *
 * The views were written against demo rows that name a side in prose rather
 * than carrying a code, and two of them each had their own regex for it:
 * /U\d{2}[A-Z]?/. That matched U19A and nothing else once schools stopped
 * having one, so a fixture list silently lost its team anchor — and a null
 * anchor NARROWS, which is how a coach ends up seeing no fixtures at all.
 *
 * One function, and it understands both halves of the vocabulary.
 */
export function teamCodeIn(name) {
  if (typeof name !== "string") return null;
  const open = /\b(\d{1,2})(?:st|nd|rd|th)?\s*XI\b/i.exec(name);
  if (open) {
    const code = `${Number(open[1])}XI`;
    if (parseTeam(code)) return code;
  }
  const age = /\bU(\d{1,2})([A-F])?\b/i.exec(name);
  if (age) {
    const code = `U${Number(age[1])}${(age[2] ?? "").toUpperCase()}`;
    if (parseTeam(code)) return code;
  }
  return null;
}

/**
 * The SQL fragment that keeps a team_code column inside the vocabulary.
 *
 * Emitted into the schema by the RLS generator rather than written by hand, so
 * the database and this module cannot disagree about what a team is. Kept
 * permissive about LEVEL — a single CHECK cannot know whether a row belongs to
 * a school or a province — so it admits any age band any level uses, and the
 * level-specific rule is isValidTeam() above.
 */
export function teamCodeCheck(column) {
  const allAges = [...new Set(Object.values(AGE_GROUPS).flat())].sort((a, b) => a - b);
  return `${column} IS NULL OR ${column} ~ '^(U(${allAges.join("|")})[A-F]?|([1-9]|1[0-9]|20)XI)$'`;
}
