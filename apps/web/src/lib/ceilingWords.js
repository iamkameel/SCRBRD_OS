/**
 * What the office is told when the Open-band bowling ceiling is refused
 * (Settings → School → Open-band bowling ceiling), in the screen's words.
 *
 * POST /api/bowling-ceiling answers a refusal with a code
 * (services/api/write/workload-api.mjs): its own checks first, then what the
 * database or the sign-in says. ApiError.message is "code (path)", so a screen
 * that shows it shows a raw code. Every code that can come back has a plain
 * sentence here. None names a child. A success is said only after the reply.
 */

export const CEILING_WORDS = {
  school_required: "Choose which school this ceiling is for, then set it.",
  max_overs_per_spell_invalid: "Overs per spell must be a whole number from 1 to 30. Leave it empty to set no limit of that kind.",
  max_overs_per_day_invalid: "Overs per day must be a whole number from 1 to 60. Leave it empty to set no limit of that kind.",
  a_ceiling_names_at_least_one_limit: "Give at least one limit, overs per spell or overs per day. To set none, leave the ceiling as it is.",
  not_permitted: "You cannot set the bowling ceiling for this school.",
  no_such_school: "That school could not be found. Choose the school again.",
  refused: "An Open-band ceiling can only be set for a high school.",
  missing_token: "You were signed out. Sign in again to set the ceiling.",
  token_expired: "You were signed out. Sign in again to set the ceiling.",
};
const CEILING_FALLBACK = "The ceiling was not set. Try again, or ask the platform office.";
const CEILING_UNREACHABLE = "SCRBRD could not be reached. The ceiling may or may not have been set. Check it before trying again.";

/**
 * A refusal in words: by code, else what we know without it. Never a raw code,
 * and never the server's `detail` (a database message).
 * @param {any} e
 */
export function ceilingWords(e) {
  if (e?.code && CEILING_WORDS[e.code]) return CEILING_WORDS[e.code];
  if (e?.status) return CEILING_FALLBACK;
  return CEILING_UNREACHABLE;
}
