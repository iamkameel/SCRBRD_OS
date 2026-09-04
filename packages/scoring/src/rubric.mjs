/**
 * SCRBRD — the assessment rubric, and the gate that stops it shipping early.
 *
 * A rubric is the skill tree, the scale, the behavioural anchors that make a
 * score mean the same thing in two coaches' hands, and the age benchmarks the
 * age-relative view is derived from.
 *
 * WHY THIS FILE EXISTS BEFORE THE ASSESSMENT TABLE DOES
 * ────────────────────────────────────────────────────
 * The spec is explicit: the schema must not ship before the anchors exist,
 * because the whole comparability argument rests on them. A 0-100 slider with
 * no anchors guarantees drift between coaches, and drift is indistinguishable
 * from a player changing — which is the exact failure the longitudinal record
 * is meant to prevent.
 *
 * That gate is easy to state and easy to forget under deadline. So it is
 * executable: `unanchoredSkills()` lists what is still unwritten, and the test
 * suite fails while the list is non-empty. Authoring the anchors is a coaching
 * task — a head coach's, not an engineer's — and this is the form they fill in.
 *
 * THE SCALE IS ABSOLUTE, NOT AGE-RELATIVE
 * ───────────────────────────────────────
 * 100 is "a first-team schoolboy performing at provincial trial standard" — a
 * definition that does not move as a player ages. A thirteen-year-old on 45 and
 * the same player on 68 at seventeen is a real, directly comparable
 * improvement.
 *
 * Rating against the standard FOR AN AGE GROUP instead would move the benchmark
 * every year, so a player who genuinely improved between U14 and U15 could
 * score lower at U15 and the chart would show regression. The age-relative view
 * is derived at render time by dividing by the benchmark; storing it instead
 * would make the absolute view underivable, and storing both would be two
 * sources of truth for one fact.
 */

export const RUBRIC_VERSION = "cricket-v1";

/**
 * The terminal standard 100 means. Written down because it is the entire basis
 * of comparability, and a rubric whose ceiling is folklore is not a rubric.
 */
export const CEILING = "A first-team schoolboy cricketer performing at provincial trial standard.";

/**
 * Age benchmarks — the expected score at each band, used ONLY to derive the
 * age-relative view. They live on the rubric so a historical assessment can be
 * re-rendered against the benchmark that was current when it was made.
 *
 * "OPEN" is a band, and it has to be. The spec keyed benchmarks by age group
 * and split the group out of the team string, which worked when a first team
 * was called U19A. Schools have no U19: above U16 a player is in the open
 * category and their team is the 1st XI, which carries no age at all.
 *
 * Deriving a band from date of birth instead is not available either —
 * `player.born` is masked behind player.pii.read, which a coach does not hold.
 * A coach who cannot read a date of birth must not be handed an age-relative
 * index computed from one. So the band is recorded ON the assessment at the
 * time it is made, and OPEN is what an open-category player gets.
 */
export const BANDS = Object.freeze(["U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "OPEN"]);

/**
 * Placeholder benchmarks. NOT authored — they are a straight line through
 * plausible endpoints, present so the shape is exercisable and clearly marked
 * so nobody mistakes them for coaching consensus.
 *
 * §11.2 of the spec is open on where the real numbers come from: coach
 * consensus first, CSA age-group norms if they can be obtained.
 */
export const BENCHMARKS_ARE_PROVISIONAL = true;

const provisional = (from, to) =>
  Object.fromEntries(BANDS.map((b, i) => [b, Math.round(from + ((to - from) * i) / (BANDS.length - 1))]));

/**
 * The skill tree. Categories and the metrics under each.
 *
 * Matches the categories already in player_skill and the metric list the write
 * path validates against, so adopting the rubric is not also a reshuffle of
 * what coaches are asked to rate.
 */
export const TREE = Object.freeze({
  batting:  ["technique", "power", "footwork", "running", "temperament"],
  bowling:  ["accuracy", "line", "variations", "pace", "stamina"],
  fielding: ["catching", "groundwork", "throwing", "positioning"],
  fitness:  ["speed", "agility", "endurance", "strength"],
});

/**
 * Behavioural anchors at 20-point intervals. A coach picks the anchor that fits
 * and may nudge within the band.
 *
 * ONE skill is authored — batting.footwork, written in the spec itself and
 * reproduced verbatim, as the worked example of what the rest must look like.
 * Every other skill is deliberately absent rather than filled with something
 * plausible: a placeholder anchor is worse than none, because a coach reads it
 * and calibrates against it.
 */
export const ANCHORS = Object.freeze({
  "batting.footwork": Object.freeze({
    20:  "Feet static; plays at the ball from the crease regardless of length.",
    40:  "Moves to the ball but late; commits front-foot only.",
    60:  "Reads length reliably; both front and back foot available; occasional late commitment against pace.",
    80:  "Decisive early movement; uses depth of crease; adjusts to spin and pace without resetting technique.",
    100: "Movement is pre-emptive and repeatable under match pressure against provincial-standard bowling.",
  }),
});

export const ANCHOR_POINTS = Object.freeze([20, 40, 60, 80, 100]);

/** Every skill in the tree, as "category.metric". */
export function allSkills() {
  return Object.entries(TREE).flatMap(([c, ms]) => ms.map((m) => `${c}.${m}`));
}

/**
 * Skills a coach would currently be rating on an unanchored scale.
 *
 * THE GATE. While this is non-empty the rubric is not ready to be assessed
 * against, and the test suite says so. It is the spec's "the schema must not
 * ship before the anchors exist", made into something that fails rather than
 * something someone remembers.
 */
export function unanchoredSkills() {
  return allSkills().filter((s) => !ANCHORS[s]);
}

/** Is this rubric complete enough to record assessments against? */
export function rubricIsReady() { return unanchoredSkills().length === 0; }

/**
 * The age-relative view: how good is this player FOR THEIR BAND.
 *
 * Takes the band recorded on the assessment, never a live date of birth — see
 * the note on BANDS. Returns null rather than a number when the band is unknown
 * or has no benchmark, because "we do not know" and "exactly average" are
 * different answers and one of them is a lie.
 */
export function ageRelative(score, band, benchmarks = BENCHMARKS) {
  if (!Number.isFinite(score)) return null;
  const expected = benchmarks?.[band];
  if (!Number.isFinite(expected) || expected <= 0) return null;
  return Math.round((score / expected) * 100) / 100;
}

export const BENCHMARKS = Object.freeze(provisional(40, 74));

/** The rubric as one object, the shape a `rubric` row will hold. */
export function rubric() {
  return {
    version: RUBRIC_VERSION,
    sport: "cricket",
    ceiling: CEILING,
    tree: TREE,
    anchors: ANCHORS,
    benchmarks: BENCHMARKS,
    benchmarksProvisional: BENCHMARKS_ARE_PROVISIONAL,
    ready: rubricIsReady(),
    unanchored: unanchoredSkills(),
  };
}
