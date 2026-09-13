/**
 * Keep a test browser off the internet.
 *
 * The client's Firebase SDK phones home on load — analytics config, the
 * installations service — and a sandbox that blocks those hosts does not
 * always refuse them quickly. Behind a slow-to-refuse proxy each page open
 * waited most of a minute for "networkidle", and a walk with nine opens took
 * nine minutes for no reason to do with the app. Aborting those requests in
 * the browser answers them instantly, the same way on every network, which
 * is also what makes the walk deterministic: nothing it asserts depends on
 * whether Google is reachable.
 *
 * Only the app's own origins get through. A test that needs a third party
 * has to say so.
 */
const THIRD_PARTY = /^(?!.*\b(localhost|127\.0\.0\.1)\b)/;

/** Abort every request that is not to localhost. Call on a context before its first page. */
export async function offline(ctx) {
  await ctx.route((url) => THIRD_PARTY.test(url.hostname), (route) => route.abort("blockedbyclient"));
}

/**
 * Is this console line the Firebase SDK talking to itself about being offline?
 *
 * Off the internet, Analytics' internal config lookup and the Installations
 * service fail and say so on their own: a bare "TypeError: Failed to fetch"
 * logged by the SDK, and an "installations/app-offline" FirebaseError that the
 * SDK also leaves as an unhandled rejection. Both are its documented offline
 * behaviour, describe a school ground with no signal as well as they describe
 * a test browser with third parties aborted, and neither is this app's code:
 * every fetch() here is caught and reported through ApiError/useLive's own
 * error state (lib/api.js, lib/live.js), so none of ours can surface as a
 * bare fetch TypeError, and nothing in apps/web imports Installations.
 *
 * Everything else — any other TypeError, any React error, any message with a
 * stack into a view — is still an error and still fails the walk.
 */
export const isFirebaseOfflineNoise = (text) =>
  /^(TypeError: Failed to fetch(\n|\s*$)|(FirebaseError: )?Installations: Could not process request\. Application offline)/.test(text);
