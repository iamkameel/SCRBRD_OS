/**
 * A deterministic grid of publicName() inputs in the shape every public read
 * passes today: no `surface`, consents as db/116's public_name_facts() returns
 * them ({by, competent, givenOn, endedOn}). public-by-terms.test.mjs holds the
 * answers over this grid to the answers main gave before PUBLIC_BY_TERMS
 * slice 2 (a digest recorded from packages/policy/src/public.mjs at main
 * 410fab53), so the rule's by-surface path cannot change what any page says
 * today.
 *
 * Invented names only. No clock, no randomness beyond the seeded generator.
 */

/** mulberry32: a small seeded generator, so the grid is the same every run. @param {number} seed */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOOL = [true, false, undefined];
const DAYS = ["2026-01-15", "2026-03-01", "2026-05-01", "2026-09-25", "2026-10-01", "15/01/2026"];
const SERVED = ["2026-05-01", "2026-09-25"];
const NAMES = [
  { fullName: "Dewald Erasmus" },
  { fullName: "Khumalo Sipho", surname: "Khumalo" },
  { fullName: "   " },
];

/**
 * Every input in the grid, in a fixed order.
 * @param {{extra?: Record<string, unknown>, consentExtra?: Record<string, unknown>}} [more]
 *   fields added to every input, or to every consent record — the by-terms
 *   inputs, which the today's-shape path must not read
 * @returns {Record<string, any>[]}
 */
export function nameGrid(more = {}) {
  const rand = seeded(20261112);
  const pick = (/** @type {readonly any[]} */ xs) => xs[Math.floor(rand() * xs.length)];
  /** @returns {Record<string, any>} */
  const record = () => {
    const givenOn = pick(DAYS);
    const end = rand();
    const endedOn = end < 0.4 ? null : end < 0.6 ? givenOn : end < 0.9 ? pick(DAYS) : "soon";
    return {
      by: pick(["guardian", "guardian", "pupil", "coach"]), competent: pick([true, true, true, false, 1]),
      givenOn, endedOn, ...(more.consentExtra ?? {}),
    };
  };
  const sets = [undefined, []];
  for (let i = 0; i < 160; i++) {
    const n = 1 + Math.floor(rand() * 3);
    sets.push(Array.from({ length: n }, record));
  }

  const out = [];
  for (const neverPublic of BOOL) for (const typed of BOOL) for (const schoolOnPlatform of BOOL)
    for (const schoolPublished of BOOL) for (const namesOff of BOOL) for (const consents of sets) {
      const on = pick(SERVED), names = pick(NAMES);
      out.push({
        on, ...names, label: pick(["Batter", "Bowler", undefined, " "]),
        neverPublic, typed, schoolOnPlatform, schoolPublished, namesOff, consents,
        ...(more.extra ?? {}),
      });
    }
  // Every fact in favour, so the consents alone decide: 3,000 sets of one to
  // four records, each judged on two days.
  for (let i = 0; i < 3000; i++) {
    const consents = Array.from({ length: 1 + Math.floor(rand() * 4) }, record);
    for (const on of SERVED) {
      out.push({
        on, ...pick(NAMES), label: "Batter",
        neverPublic: false, typed: false, schoolOnPlatform: true, schoolPublished: true, namesOff: false, consents,
        ...(more.extra ?? {}),
      });
    }
  }
  return out;
}
