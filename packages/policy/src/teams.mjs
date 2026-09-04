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
