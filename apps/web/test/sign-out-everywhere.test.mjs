/**
 * Sign out everywhere (Settings → Me): lib/signOutEverywhere.js and the screen
 * as first drawn.
 *
 *   - the question is the sentence Kameel gave, word for word
 *   - this device is signed out only AFTER the server answers OK, once; a
 *     refusal, a session that had already ended and no answer at all each
 *     leave the person signed in, in words
 *   - drawn: the button first, no confirmation until asked, and no word of
 *     having signed anybody out
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/sign-out-everywhere.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SIGN_OUT_EVERYWHERE_ABOUT, SIGN_OUT_EVERYWHERE_CONFIRM, signOutEverywhere, signOutEverywhereWords,
} from "../src/lib/signOutEverywhere.js";
import { SignOutEverywhere } from "../src/views/signoutall.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const refusal = (status, code) => Object.assign(new Error(code), { status, code });
/** A stand-in for api(): records the calls and the order of events. */
const run = async (answer) => {
  const log = [];
  const post = async (path, opts) => {
    log.push(`post ${opts.method} ${path}`);
    if (answer instanceof Error) throw answer;
    log.push("answered");
    return answer;
  };
  const said = await signOutEverywhere({ post, onSignedOut: () => log.push("device signed out") });
  return { log, said };
};

group("The question");
ok("it is the sentence asked for", SIGN_OUT_EVERYWHERE_CONFIRM === "This signs you out on every device, including this one.");
ok("the explanation names the pad", /pad you are scoring with/.test(SIGN_OUT_EVERYWHERE_ABOUT));

group("This device follows the server, never leads it");
{
  const ok1 = await run({ signedOut: true });
  ok("it posts to the route", ok1.log[0] === "post POST /api/auth/sign-out-everywhere", ok1.log.join(" | "));
  ok("the device is signed out after the answer, once", ok1.log.join(" | ") === "post POST /api/auth/sign-out-everywhere | answered | device signed out", ok1.log.join(" | "));
  ok("...and nothing is said: the person is taken to sign in", ok1.said === null);

  const no = await run(refusal(403, "not_permitted"));
  ok("a refusal: the device is not signed out", !no.log.includes("device signed out"), no.log.join(" | "));
  ok("...it is a refusal, in words, that says nobody was signed out", no.said.kind === "refused" && /Nobody was signed out/.test(no.said.text) && !no.said.text.includes("not_permitted"), no.said?.text);
  ok("...and offers no way back (the session is still good)", no.said.ended === false);

  const gone = await run(refusal(401, "session_revoked"));
  ok("a session that had already ended: the device is not signed out by this", !gone.log.includes("device signed out"));
  ok("...it says so and offers the way back", gone.said.kind === "refused" && gone.said.ended === true && /sign in again/.test(gone.said.text), gone.said?.text);
  const out = await run(refusal(401, "not_signed_in"));
  ok("not signed in is the same", out.said.ended === true);

  const down = await run(new Error("fetch failed"));
  ok("no answer at all: the device is not signed out", !down.log.includes("device signed out"));
  ok("...it is a failure, and says nobody was signed out", down.said.kind === "failed" && /nobody was signed out/.test(down.said.text), down.said?.text);

  const odd = await run(refusal(500, "internal_error"));
  ok("an answer nobody expected is a failure that shows what it was", odd.said.kind === "failed" && /internal_error/.test(odd.said.text) && /nobody was signed out/.test(odd.said.text), odd.said?.text);
  ok("words exist for the two refusals the database gives",
     signOutEverywhereWords(refusal(403, "not_permitted")).text.includes("pad") && signOutEverywhereWords(refusal(401, "not_signed_in")).kind === "refused");
}

group("Drawn");
{
  const html = renderToStaticMarkup(h(SignOutEverywhere, { onSignedOut: () => {}, post: async () => ({}) }));
  ok("the title and the button", html.includes("Sign out everywhere") && html.includes('data-testid="sign-out-everywhere-ask"'));
  ok("the question is not asked until the button is pressed", !html.includes(SIGN_OUT_EVERYWHERE_CONFIRM) && !html.includes("sign-out-everywhere-yes"));
  ok("nothing is claimed in advance", !/signed out of|has been signed out|you are signed out/i.test(html));
  ok("no refusal is drawn before there is one", !html.includes('role="alert"'));
  ok("the button is 44px tall and its type 13px", /min-height:44px/.test(html) && /font-size:13px/.test(html));
}

console.log(`\nSIGN OUT EVERYWHERE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
