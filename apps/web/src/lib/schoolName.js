/**
 * A side's school, by name alone (EXPERIENCE_PASS Q8): the label without its
 * team ("Hilton College 1XI", "1XI" → "Hilton College"). Shared by the public
 * page's follow offer and the app's confirming tap, which must name the same
 * school; it imports nothing, so the public bundle stays free of the app's
 * client (tools/check-bundle.mjs).
 * @param {string | null | undefined} label @param {string | null | undefined} team
 */
export function schoolOfSide(label, team) {
  const full = String(label ?? "").trim();
  const t = String(team ?? "").trim();
  return t && full.toLowerCase().endsWith(` ${t.toLowerCase()}`) ? full.slice(0, full.length - t.length - 1).trim() : full;
}

/** A school code as a link may carry it (school.code: "HIL", "verify-051"). */
export const SCHOOL_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
