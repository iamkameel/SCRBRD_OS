/**
 * SCRBRD — signing out everywhere (Settings → Me), the pure half of
 * views/signoutall.jsx.
 *
 * POST /api/auth/sign-out-everywhere (db/85, auth_sign_out_everywhere()) moves
 * the person's session epoch: every token and every pad credential they hold
 * ends, this device's included. The route answers { signedOut: true } and
 * nothing else; the screen then signs this device out too, which is what
 * ends it here.
 *
 * Nothing here decides anything: the database refuses a person who is not
 * signed in and a scoring pad's credential, and these are the sentences for
 * the two, and for the answer that never came.
 */

/** Said before the act, word for word. */
export const SIGN_OUT_EVERYWHERE_CONFIRM = "This signs you out on every device, including this one.";

/** What the person is told first, beside the button. */
export const SIGN_OUT_EVERYWHERE_ABOUT =
  "Ends your sign-in on every phone, tablet and computer you have used, and on any pad you are scoring with. You sign in again with a code from your school office, or with Google if you added it.";

/**
 * The act: ask the server, and only when it answers OK sign this device out.
 * Anything else leaves the person signed in everywhere and says why.
 *
 * `ended` is true when the refusal is that this device's own sign-in is already
 * gone (a 401): there is nothing to keep, so the screen offers the way back.
 *
 * @param {{ post: (path: string, opts: { method: string }) => Promise<unknown>, onSignedOut: () => void }} a
 * @returns {Promise<null | { kind: "refused" | "failed", text: string, ended: boolean }>}  null when it is done
 */
export async function signOutEverywhere({ post, onSignedOut }) {
  try {
    await post("/api/auth/sign-out-everywhere", { method: "POST" });
  } catch (/** @type {any} */ e) {
    return { ...signOutEverywhereWords(e), ended: e?.status === 401 || e?.code === "not_signed_in" };
  }
  onSignedOut();
  return null;
}

/**
 * The sentence for a refusal or a failure, and which of the two it is. The
 * person stays signed in on every device, because nothing was changed.
 * @param {any} e  an ApiError, or whatever was thrown
 * @returns {{ kind: "refused" | "failed", text: string }}
 */
export function signOutEverywhereWords(e) {
  const status = e?.status;
  if (status === undefined || status === null) {
    return { kind: "failed", text: "Could not reach SCRBRD, so nobody was signed out. Check your connection and try again." };
  }
  if (e?.code === "not_signed_in" || status === 401) {
    return { kind: "refused", text: "Your sign-in on this device has already ended. Nothing more was needed here: sign in again to carry on." };
  }
  if (e?.code === "not_permitted") {
    return { kind: "refused", text: "A scoring pad's sign-in cannot sign you out everywhere. Sign in on the full site to do it. Nobody was signed out." };
  }
  return { kind: "failed", text: `That did not go through (${e?.code || `HTTP ${status}`}), so nobody was signed out. Try again.` };
}
