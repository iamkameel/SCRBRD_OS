/**
 * SCRBRD — the ways a person signs in, and the office's claims list
 * (SCRBRD-140 §3.4, §3.7). The pure half of Me → "Ways to sign in" and of the
 * People tab's Claims list: what a row says, and what a refusal is called.
 *
 * Both lists come from the governed read path (my_sign_ins, sign_in_claims) and
 * never carry the provider's uid; nothing here could show one.
 */

const PROVIDER = { "google.com": "Google", "microsoft.com": "Microsoft", "emailLink": "An emailed link" };

/** How a sign-in came to be on the account, in the person's words. */
export const HOW_WORDS = Object.freeze({
  new_account: "Made this account",
  office_confirmed: "Confirmed by your school office",
  code: "Added after a code from your school office",
  self_added: "Added by you",
  register: "From your school's staff list",
});

/** @param {string | null | undefined} t */
const day = (t) => (t ? new Date(t).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : null);

/**
 * A sign-in row as the screen reads it.
 * @param {{ id: string, provider: string, email_at_link: string, linked_at: string, linked_how: string, last_sign_in_at?: string | null, revoked_at?: string | null }} r
 * @param {string | null | undefined} [accountEmail]  the address the school enrolled the account under
 */
export function describeSignIn(r, accountEmail = null) {
  const email = r.email_at_link ?? "";
  return {
    id: r.id,
    provider: PROVIDER[r.provider] ?? "Another account",
    email,
    live: !r.revoked_at,
    added: day(r.linked_at),
    lastUsed: day(r.last_sign_in_at),
    removed: day(r.revoked_at),
    how: HOW_WORDS[r.linked_how] ?? null,
    // §3.5: Google's address may differ from the one the school holds. Said, not acted on.
    differs: !!accountEmail && email.toLowerCase() !== String(accountEmail).toLowerCase(),
  };
}

/** Live ones first, newest first within each. @param {any[]} rows */
export function ordered(rows) {
  return [...rows].sort((a, b) => (!!a.revoked_at - !!b.revoked_at) || String(b.linked_at).localeCompare(String(a.linked_at)));
}

/**
 * Removing this one would leave no Google sign-in. Not a refusal (the school
 * office can always issue a code, §3.6); a sentence for the person to read first.
 * @param {any[]} rows @param {string} id
 */
export function isLastLive(rows, id) {
  const live = rows.filter((r) => !r.revoked_at);
  return live.length === 1 && live[0].id === id;
}

/** The server's refusals have their own sentence (`detail`); these are for the ones it cannot give. */
export const SIGN_IN_WORDS = Object.freeze({
  unreachable: "Could not reach SCRBRD. Check your connection and try again; nothing was changed.",
  refused: "That was not done. Nothing was changed.",
});

/** @param {any} e */
export function signInWords(e) {
  if (e?.detail) return e.detail;
  if (e?.status === undefined || e?.status === null) return SIGN_IN_WORDS.unreachable;
  return SIGN_IN_WORDS.refused;
}

/**
 * The claims list: one line a person at the office reads.
 * @param {{ id: string, user_id: string, account_name: string, account_email: string, account_active: boolean, presented_email: string, provider: string, requested_at: string, last_requested_at?: string | null }} c
 */
export function describeClaim(c) {
  return {
    id: c.id,
    userId: c.user_id,
    name: c.account_name,
    enrolledAs: c.account_email,
    google: c.presented_email,
    provider: PROVIDER[c.provider] ?? "Another account",
    asked: day(c.requested_at),
    askedAgain: c.last_requested_at && c.last_requested_at !== c.requested_at ? day(c.last_requested_at) : null,
    // A deactivated account is the office's to look at harder (§3.3).
    inactive: c.account_active === false,
    // A different address is worth a second look. The same one is the usual case.
    sameAddress: String(c.account_email ?? "").toLowerCase() === String(c.presented_email ?? "").toLowerCase(),
  };
}

/** What the office is told after it acts on a claim. */
export const CLAIM_DONE = Object.freeze({
  confirmed: "Confirmed. Their next Google sign-in opens that account.",
  declined: "Declined. That Google account is not linked to the account. If they try again, you are asked again.",
});
