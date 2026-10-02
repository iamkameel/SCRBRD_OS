# Signing in with Google: the privacy notice paragraph (SCRBRD-140)

**For:** Kameel, as information officer. **Drafted:** 2026-10-02 by Claude, from
`docs/design/SCRBRD-140_signup_and_school_linking.md` §7.4–7.5. **Status:** **signed by Kameel, information officer, on 2026-10-02** (on the Build Board, "I sign it as written"). It goes into the privacy notice with the sign-up screens.

This is a draft for the information officer, not legal advice. Check the section numbers and the
transfer basis against your own reading of POPIA, or with counsel, before you sign.

## The paragraph (goes into the privacy notice as written)

> **Signing in with Google.** You can sign in to SCRBRD with a Google account instead of a code
> from your school office. When you do, Google confirms to us that you hold that Google account
> and that its email address is verified. To do this, Google (through its Firebase Authentication
> service) keeps a sign-in record for you: an account number, your email address, your name as it
> appears on your Google account, how you signed in, and when you last did. Google stores that
> record on its servers outside South Africa, under its data processing terms. We keep only the
> account number and your verified email address, and, for a new account, your name, which you
> can change. We never take your Google profile photo. Your school's records, your cricket
> records, and anything about your health, availability or conduct stay on SCRBRD's own systems
> and are never sent to Google. Signing in with Google is your choice. You can stop using it,
> remove it from your account, or ask your school office for a sign-in code instead at any time.
> Pupils under 13 sign in with a code from the school office, not with Google.

## Why this wording (for the record, not for the notice)

| point | where it comes from |
|---|---|
| What Google holds | SCRBRD-140 §7.4: uid, email, provider, display name, last sign-in, held by Firebase Auth; we do not read it back or write to it |
| What we keep | §7.4: the uid, the verified email, and the name on a new account only; never the picture |
| Outside South Africa | A6: Firebase Auth has no South African data location |
| The transfer basis | POPIA s72: a recipient bound by terms that give adequate protection (Google's data processing terms), and a sign-in the person chooses, not a background collection (D13) |
| Cricket, health and conduct records never go to Google | §7.5 and §8: the exchange ends in SCRBRD's own token; Firebase is a verifier, never a store |
| Under 13 | §7.2 and A2 (confirmed 13 by Kameel, 2026-10-02) |
| The alternative | the office code stays (§2.4, §3.6) |

## Signing

That this paragraph is added to the privacy notice before Google sign-in goes live.

**Signed:** Kameel (information officer) **Date:** 2026-10-02
