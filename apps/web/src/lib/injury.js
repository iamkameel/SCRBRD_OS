/**
 * The Injuries screen's words and counts (GA-I19 design, D7).
 *
 * The database keeps three phases and three severities (db/00_schema_core.sql,
 * the CHECKs on `injury`). The screen shows those and no others: a clinical
 * sub-phase (immobilisation, strengthening, return to bowl) is the physio's
 * note, not a state. apps/web/test/injuries.test.mjs reads the CHECKs from the
 * schema and fails if these tables drift from them.
 *
 * `phase` and `severity` are the nature tier (medical.nature.read) and arrive
 * NULL for a status-only reader; `restricted` is the status tier. A count of
 * phases is drawn only where the phase was read: "Out" is the status fact.
 */

/** Database phase → the word the screen shows. */
const PHASE_WORDS = { active: "Injured", rehab: "Rehabilitating", cleared: "Cleared" };

/** Database severity → the word the screen shows. */
const SEVERITY_WORDS = { minor: "Minor", moderate: "Moderate", severe: "Severe" };

/** A phase word, or null where the phase was not read or is not one of ours. */
const phaseWord = (phase) => (Object.hasOwn(PHASE_WORDS, phase) ? PHASE_WORDS[phase] : null);

/** A severity word, or null where the severity was not read or is not one of ours. */
const severityWord = (severity) => (Object.hasOwn(SEVERITY_WORDS, severity) ? SEVERITY_WORDS[severity] : null);

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * The tile counts for a set of injury rows.
 *
 *   injured        phase = 'active'
 *   rehab          phase = 'rehab'
 *   out            restricted (the status tier; what a status-only reader gets)
 *   returningSoon  rtw within 7 days of `now`
 *
 * `natureTier` says whether this reader holds medical.nature.read. When not,
 * `injured` and `rehab` are null: the phase is not theirs to count, and a zero
 * made of NULLs would be a figure nobody made.
 */
function injuryCounts(rows, { natureTier, now }) {
  const withPhase = (p) => rows.filter((i) => i.phase === p).length;
  return {
    injured: natureTier ? withPhase("active") : null,
    rehab: natureTier ? withPhase("rehab") : null,
    out: rows.filter((i) => i.restricted).length,
    returningSoon: rows.filter((i) => {
      const d = (new Date(i.rtw) - now) / DAY_MS;
      return d >= 0 && d <= 7;
    }).length,
  };
}

export { PHASE_WORDS, SEVERITY_WORDS, injuryCounts, phaseWord, severityWord };
