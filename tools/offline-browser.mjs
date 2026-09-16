/**
 * Keep a test browser off the internet.
 *
 * The client's Firebase SDK used to phone home on load — analytics config,
 * the installations service — and a sandbox that blocks those hosts does not
 * always refuse them quickly. Behind a slow-to-refuse proxy each page open
 * waited most of a minute for "networkidle", and a walk with nine opens took
 * nine minutes for no reason to do with the app. Aborting those requests in
 * the browser answers them instantly, the same way on every network, which
 * is also what makes the walk deterministic: nothing it asserts depends on
 * whether Google is reachable.
 *
 * Only the app's own origins get through. A test that needs a third party
 * has to say so.
 *
 * Analytics now starts only on a device that consented (lib/firebase.js), so
 * no walk should see the SDK's offline chatter unless it turned the switch on
 * itself. The filter that used to excuse that chatter is gone: a Firebase
 * error in a walk is now a walk that started Firebase, and has to say why.
 */
const THIRD_PARTY = /^(?!.*\b(localhost|127\.0\.0\.1)\b)/;

/** Abort every request that is not to localhost. Call on a context before its first page. */
export async function offline(ctx) {
  await ctx.route((url) => THIRD_PARTY.test(url.hostname), (route) => route.abort("blockedbyclient"));
}
