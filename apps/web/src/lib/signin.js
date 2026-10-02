/**
 * SCRBRD — the exchange: Google's ID token for SCRBRD's own (SCRBRD-140 §2.2).
 *
 * POST /api/auth/firebase { idToken, deviceId } answers one of a handful of
 * things, and each is a STATE the sign-in screen draws. This is where they are
 * told apart, with no React and no network of its own, so a test can hand it
 * every answer the server gives (services/api/auth/signin-api.mjs) and hold
 * the states to the design's §3.3 table.
 *
 *   200 { token, outcome }   → "token"           signed_in | new_account | linked
 *   409 claim_required       → "claim_required"  the address matches an account
 *                                                the office enrolled: no token,
 *                                                and the office is told
 *   401 identity_revoked     → "refused"         this Google account was removed
 *   403 account_inactive     → "refused"
 *   401 <the verifier's>     → "refused"         a token Google did not stand behind
 *   429 rate_limited         → "slow_down"       try again in a minute
 *   503 keys_unavailable     → "use_code"        Google's keys cannot be fetched:
 *                                                the server fails closed, and the
 *                                                office code is the way in (§2.3)
 *   no answer at all         → "unreachable"
 *
 * WHAT NONE OF THEM SAYS. "claim_required" never says what the account holds,
 * whether it is a child's, or that one exists beyond "your school office set up
 * an account for this address" — the sentence the server already gives the
 * office's Claims list and nothing more. The words are the screen's.
 */
import { api } from "./api.js";
import { deviceId } from "./device.js";

/** @typedef {{ state: "token", token: string, outcome: "signed_in" | "new_account" | "linked" }
 *          | { state: "claim_required" }
 *          | { state: "use_code", words: string }
 *          | { state: "slow_down", words: string }
 *          | { state: "unreachable", words: string }
 *          | { state: "refused", code: string, words: string }} ExchangeAnswer */

/** Words for the refusals, by the server's code. A code with no entry still says something. */
export const EXCHANGE_WORDS = {
  identity_revoked: "That Google account was removed from the sign-in methods for this account. Ask your school office for a sign-in code.",
  account_inactive: "This account is not active. Ask your school office.",
  missing_device: "This browser could not be recognised. Reload the page and try again.",
  email_unverified: "Google has not verified that email address, so it cannot be used to sign in. Verify it with Google, or use a code from your school office.",
  provider_not_allowed: "That kind of sign-in is not accepted yet. Use Google, or a code from your school office.",
  stale_sign_in: "That Google sign-in was too old. Press Continue with Google and try again.",
  token_expired: "That Google sign-in expired before it could be used. Press Continue with Google and try again.",
  rate_limited: "Too many sign-ins from here just now. Wait a minute and try again, or use a code from your school office.",
  keys_unavailable: "Google sign-in is not available right now. Use a code from your school office instead; it works the same way.",
  claim_required: "Your school office set up an account for this email address. For your safety the office checks that it is you before Google can open it. They have been asked to; you can also ask them for a sign-in code.",
  not_found: "That sign-in could not be completed. Try again, or use a code from your school office.",
  refused: "That sign-in could not be completed. Try again, or use a code from your school office.",
};
const GENERIC = "Google sign-in could not be completed. Try again, or use a code from your school office.";
const UNREACHABLE = "Could not reach SCRBRD. Check your connection and try again.";

/**
 * Turn what the exchange did (an answer, or a thrown ApiError) into a state.
 * @param {{ ok: true, body: any } | { ok: false, error: any }} result
 * @returns {ExchangeAnswer}
 */
export function exchangeState(result) {
  if (result.ok) {
    const b = result.body ?? {};
    if (typeof b.token === "string" && b.token) {
      return { state: "token", token: b.token, outcome: b.outcome === "new_account" || b.outcome === "linked" ? b.outcome : "signed_in" };
    }
    // A 200 with no token is not a sign-in, whatever else it says.
    return { state: "refused", code: "no_token", words: GENERIC };
  }
  const e = result.error;
  const status = e?.status;
  const code = String(e?.code ?? "");
  if (status === undefined || status === null) return { state: "unreachable", words: UNREACHABLE };
  if (status === 409 && code === "claim_required") return { state: "claim_required" };
  if (status === 429) return { state: "slow_down", words: EXCHANGE_WORDS.rate_limited };
  if (status === 503) return { state: "use_code", words: EXCHANGE_WORDS.keys_unavailable };
  if (status >= 500) return { state: "unreachable", words: UNREACHABLE };
  return { state: "refused", code: code || `http_${status}`, words: EXCHANGE_WORDS[code] ?? GENERIC };
}

/**
 * The exchange. `post` and `device` are injectable for a test.
 * @param {string} idToken
 * @param {{ post?: typeof api, device?: () => string }} [deps]
 * @returns {Promise<ExchangeAnswer>}
 */
export async function exchangeGoogle(idToken, { post = api, device = deviceId } = {}) {
  try {
    const body = await post("/api/auth/firebase", { method: "POST", body: { idToken, deviceId: device() } });
    return exchangeState({ ok: true, body });
  } catch (error) {
    return exchangeState({ ok: false, error });
  }
}

/**
 * What a claim-required screen offers, in order. The office confirms (one tap
 * on its Claims list) or issues a code; either way one person looked (§3.3).
 */
export const CLAIM_STEPS = [
  "The school office has been asked to confirm that this Google account is yours.",
  "Once they have, press Continue with Google again.",
  "Or ask them for a sign-in code and enter it below. Then you can add Google from Me.",
];
