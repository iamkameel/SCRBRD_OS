/**
 * SCRBRD — the assessment rubric, and the gate that stops it shipping early.
 *
 * A rubric is the attribute set, the scale, the behavioural anchors that make a
 * score mean the same thing in two coaches' hands, and the age benchmarks the
 * age-relative view is derived from.
 *
 * WHY THIS FILE EXISTS BEFORE THE ASSESSMENT TABLE DOES
 * ────────────────────────────────────────────────────
 * The spec is explicit: the schema must not ship before the anchors exist,
 * because the whole comparability argument rests on them. A numbered scale with
 * no anchors guarantees drift between coaches, and drift is indistinguishable
 * from a player changing — which is the exact failure the longitudinal record
 * is meant to prevent.
 *
 * That gate is easy to state and easy to forget under deadline. So it is
 * executable: `unanchoredSkills()` lists what is still unwritten, and the test
 * suite fails while the list is non-empty. Authoring the anchors is a coaching
 * task — a head coach's, not an engineer's — and this is the form they fill in.
 *
 * THE SCALE IS 1-20, AND IT IS ABSOLUTE RATHER THAN AGE-RELATIVE
 * ─────────────────────────────────────────────────────────────
 * Twenty points, on the Football Manager convention: 1-5 poor, 6-10 average,
 * 11-15 good, 16-20 excellent. A 0-100 slider invites false precision — no
 * coach can defend the difference between a 63 and a 66, and the moment two
 * coaches disagree at that resolution the longitudinal record is noise. Twenty
 * steps is about as fine as human judgement actually resolves, and it makes a
 * one-point move mean something.
 *
 * 20 is "a first-team schoolboy performing at provincial trial standard" — a
 * definition that does not move as a player ages. A thirteen-year-old on 9 and
 * the same player on 14 at seventeen is a real, directly comparable
 * improvement.
 *
 * Rating against the standard FOR AN AGE GROUP instead would move the benchmark
 * every year, so a player who genuinely improved between U14 and U15 could
 * score lower at U15 and the chart would show regression. The age-relative view
 * is derived at render time by dividing by the benchmark; storing it instead
 * would make the absolute view underivable, and storing both would be two
 * sources of truth for one fact.
 */

import { DRAFT_ANCHORS, DRAFTED } from "./rubric-drafts.mjs";

export const RUBRIC_VERSION = "cricket-v1";

/**
 * The terminal standard 100 means. Written down because it is the entire basis
 * of comparability, and a rubric whose ceiling is folklore is not a rubric.
 */
export const CEILING = "A first-team schoolboy cricketer performing at provincial trial standard.";

/** The scale. 1 is the floor, not 0: nobody has an absence of an attribute. */
export const SCALE_MIN = 1;
export const SCALE_MAX = 20;

/**
 * What the numbers mean in words, so a screen can label a bar and two coaches
 * can argue about a boundary instead of about a number.
 */
export const BANDS_OF_SCALE = Object.freeze([
  Object.freeze({ from: 1,  to: 5,  label: "Poor" }),
  Object.freeze({ from: 6,  to: 10, label: "Average" }),
  Object.freeze({ from: 11, to: 15, label: "Good" }),
  Object.freeze({ from: 16, to: 20, label: "Excellent" }),
]);

/** Where on the scale a score sits, in words. */
export function scaleBand(score) {
  if (!Number.isFinite(score)) return null;
  return BANDS_OF_SCALE.find((b) => score >= b.from && score <= b.to)?.label ?? null;
}

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
 * The attribute set, split TECHNICAL / MENTAL / PHYSICAL.
 *
 * The split is Football Manager's and it is the right one, because it separates
 * three things that improve differently, are coached differently, and are
 * observed differently:
 *
 *   TECHNICAL — the craft. What a player can do with a bat, a ball or their
 *     hands. Improves with repetition in the nets; visible in a single session.
 *   MENTAL — the head. Concentration, decisions, courage, what they do when the
 *     game is tight. Improves slowly, and only really shows in matches.
 *   PHYSICAL — the body. Largely age and maturation, partly training, and the
 *     one group where a thirteen-year-old is not being judged against a
 *     seventeen-year-old on anything he can control.
 *
 * The previous four categories — batting, bowling, fielding, fitness — split by
 * DISCIPLINE, which reads naturally and hides the thing a development record is
 * for. A boy whose batting stalls has either stopped improving technically or
 * has stopped concentrating, and those need opposite conversations. Grouping by
 * discipline puts "technique" and "temperament" in the same column and makes
 * that distinction unaskable.
 *
 * The discipline view is not lost — see DISCIPLINES below. Attributes are
 * GROUPED for presentation and coaching, and CROSS-CUT by discipline for
 * evaluation against the ball log. Both are real; neither is derivable from
 * the other; so both are written down.
 *
 * A coach is not expected to fill in all of these every time. The assessment
 * write path upserts per (player, date, group, attribute), so a partial
 * assessment — the four things you actually watched on Saturday — is the normal
 * case rather than an incomplete one.
 */
export const TREE = Object.freeze({
  technical: [
    // With the bat
    "footwork", "timing", "power", "shotRange", "defence", "againstPace", "againstSpin",
    // With the ball
    "lineAndLength", "seamAndSwing", "spin", "variations",
    // In the field, and behind the stumps
    "catching", "groundFielding", "throwing", "glovework",
  ],
  mental: [
    "concentration", "composure", "decisions", "anticipation", "determination",
    "bravery", "leadership", "teamwork", "workRate", "gameAwareness",
  ],
  physical: [
    "pace", "acceleration", "agility", "balance", "stamina", "strength",
    "naturalFitness", "bowlingPace",
  ],
});

/**
 * The same attributes, cut by DISCIPLINE instead of by group.
 *
 * This is what the performance index argues with. The ball log knows how many
 * runs a boy scored off how many deliveries; it does not know whether that was
 * footwork or timing, so it can only speak to a discipline as a whole. The
 * coach's number for a discipline is the mean of the attributes listed here,
 * and THAT is what match evidence adjusts (see adjustedRating in rating.mjs).
 *
 * Note which attributes appear twice and which appear nowhere. `bravery` counts
 * towards batting because facing genuine pace is a batting attribute in
 * schoolboy cricket whatever else it is; `bowlingPace` counts towards bowling
 * though it sits in PHYSICAL. `leadership` belongs to no discipline, which is
 * correct — it is real, it is assessed, and no scorecard will ever measure it.
 */
export const DISCIPLINES = Object.freeze({
  batting: Object.freeze([
    "technical.footwork", "technical.timing", "technical.power", "technical.shotRange",
    "technical.defence", "technical.againstPace", "technical.againstSpin",
    "mental.concentration", "mental.composure", "mental.decisions", "mental.bravery",
  ]),
  bowling: Object.freeze([
    "technical.lineAndLength", "technical.seamAndSwing", "technical.spin",
    "technical.variations", "physical.bowlingPace", "physical.stamina",
    "mental.concentration", "mental.composure",
  ]),
  fielding: Object.freeze([
    "technical.catching", "technical.groundFielding", "technical.throwing",
    "mental.anticipation", "physical.agility", "physical.acceleration",
  ]),
  keeping: Object.freeze([
    "technical.glovework", "technical.catching",
    "mental.concentration", "physical.agility", "physical.balance",
  ]),
});

/**
 * Disciplines the ball log can speak to at all.
 *
 * ball_event records who faced, who bowled and what happened. It records no
 * catch except inside free-text dismissal wording, and nothing anywhere
 * measures a sprint — so fielding and keeping are coach-assessed or they are
 * absent. Deriving them from batting numbers would be fabrication.
 */
export const DERIVABLE_DISCIPLINES = Object.freeze(["batting", "bowling"]);
export const COACH_ONLY_DISCIPLINES = Object.freeze(["fielding", "keeping"]);

/**
 * Behavioural anchors at four-point intervals. A coach picks the anchor that
 * fits and may nudge within the band.
 *
 * ONE attribute is authored — technical.footwork, written in the spec itself
 * and reproduced here against the 1-20 scale, as the worked example of what the
 * rest must look like. Every other attribute is deliberately absent rather than
 * filled with something plausible: a placeholder anchor is worse than none,
 * because a coach reads it and calibrates against it.
 */
export const ANCHORS = Object.freeze({
  "technical.footwork": Object.freeze({
    4:  "Feet static; plays at the ball from the crease regardless of length.",
    8:  "Moves to the ball but late; commits front-foot only.",
    12: "Reads length reliably; both front and back foot available; occasional late commitment against pace.",
    16: "Decisive early movement; uses depth of crease; adjusts to spin and pace without resetting technique.",
    20: "Movement is pre-emptive and repeatable under match pressure against provincial-standard bowling.",
  }),
});

/**
 * Drafts, kept deliberately apart from ANCHORS.
 *
 * 32 attributes have a first-pass anchor set written to be argued with, so the
 * people who actually know have something to redline rather than a blank form.
 * They do NOT close the gate and they are not consensus — see rubric-drafts.mjs.
 *
 * They are re-exported here so a caller has one place to ask, and so the two
 * can never be confused for one another: anything that shows an anchor asks
 * anchorFor(), which says which kind it got.
 */
export { DRAFT_ANCHORS, DRAFTED };

/**
 * The anchor set for one attribute, and its standing.
 *
 * Returns null when there is neither. `status` is the whole point: a screen
 * that shows a draft is obliged to say so, because a coach who calibrates
 * against an unapproved sentence produces drift, and drift is
 * indistinguishable from a player changing.
 */
export function anchorFor(skill) {
  if (ANCHORS[skill]) return { points: ANCHORS[skill], status: "authored" };
  if (DRAFT_ANCHORS[skill]) return { points: DRAFT_ANCHORS[skill], status: "draft" };
  return null;
}

export const ANCHOR_POINTS = Object.freeze([4, 8, 12, 16, 20]);

/** Every attribute in the tree, as "group.attribute". */
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

/** Attributes with a DRAFT anchor and no approved one — the redline queue. */
export function draftedSkills() {
  return allSkills().filter((s) => !ANCHORS[s] && DRAFT_ANCHORS[s]);
}

/** Attributes with neither. Nobody has even proposed a sentence for these. */
export function unwrittenSkills() {
  return allSkills().filter((s) => !ANCHORS[s] && !DRAFT_ANCHORS[s]);
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

export const BENCHMARKS = Object.freeze(provisional(8, 15));

/** The rubric as one object, the shape a `rubric` row will hold. */
export function rubric() {
  return {
    version: RUBRIC_VERSION,
    sport: "cricket",
    ceiling: CEILING,
    scale: { min: SCALE_MIN, max: SCALE_MAX, bands: BANDS_OF_SCALE },
    tree: TREE,
    disciplines: DISCIPLINES,
    anchors: ANCHORS,
    draftAnchors: DRAFT_ANCHORS,
    benchmarks: BENCHMARKS,
    benchmarksProvisional: BENCHMARKS_ARE_PROVISIONAL,
    ready: rubricIsReady(),
    unanchored: unanchoredSkills(),
    drafted: draftedSkills(),
    unwritten: unwrittenSkills(),
  };
}
