/**
 * The privacy-notice paragraph for signing in with Google (SCRBRD-140 §7.5),
 * word for word as Kameel, as information officer, signed it on 2026-10-02
 * (docs/policy/SIGNIN_PRIVACY_NOTICE.md). It is shown where a person chooses to
 * sign in with Google (the sign-in screen) and where they add another way to
 * (Me). apps/web/test/signin.test.mjs holds this text equal to the signed one,
 * so an edit here that the information officer has not signed fails a test.
 */
export const SIGNIN_NOTICE_TITLE = "Signing in with Google.";
export const SIGNIN_NOTICE = "You can sign in to SCRBRD with a Google account instead of a code from your school office. When you do, Google confirms to us that you hold that Google account and that its email address is verified. To do this, Google (through its Firebase Authentication service) keeps a sign-in record for you: an account number, your email address, your name as it appears on your Google account, how you signed in, and when you last did. Google stores that record on its servers outside South Africa, under its data processing terms. We keep only the account number and your verified email address, and, for a new account, your name, which you can change. We never take your Google profile photo. Your school's records, your cricket records, and anything about your health, availability or conduct stay on SCRBRD's own systems and are never sent to Google. Signing in with Google is your choice. You can stop using it, remove it from your account, or ask your school office for a sign-in code instead at any time. Pupils under 13 sign in with a code from the school office, not with Google.";
