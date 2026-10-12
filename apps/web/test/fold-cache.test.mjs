/**
 * The family fold cache is one session's (views/family/useFold.js). Signing
 * out does not reload the page, so a cache that outlived the session would
 * serve the last person's children's lines to the next person on the device.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setToken, resetApi } from "../src/lib/api.js";
import { foldCache, forgetFolds, loadFold } from "../src/views/family/useFold.js";

const LINE = { innings: [{ runs: 17 }], result: null };

test("the fold cache is kept within one session", () => {
  forgetFolds();
  setToken("bearer-a");
  foldCache().set("m1", LINE);
  assert.equal(foldCache().get("m1"), LINE);
  resetApi();
});

test("a sign-out empties the fold cache", () => {
  forgetFolds();
  setToken("bearer-a");
  foldCache().set("m1", LINE);
  resetApi(); // what signOut() does to the token
  assert.equal(foldCache().size, 0);
});

test("the next person signing in does not see the last person's folds", () => {
  forgetFolds();
  setToken("bearer-a");
  foldCache().set("m1", LINE);
  setToken("bearer-b"); // an expired session, then someone else, with no sign-out between
  assert.equal(foldCache().has("m1"), false);
  resetApi();
});

/** A read that answers when told to, so a session can change while it is on its way. */
function pending() {
  let answer, fail;
  const read = () => new Promise((res, rej) => { answer = res; fail = rej; });
  return { read, answer: (v) => answer(v), fail: (e) => fail(e) };
}

test("an answer for the last session never lands in the next one's cache", async () => {
  forgetFolds();
  setToken("bearer-a");
  const req = pending();
  const loading = loadFold("m1", "complete", req.read);
  resetApi();                // A signs out while the read is on its way…
  setToken("bearer-b");      // …and B signs in on the same device
  req.answer({ events: [], fold: {} });
  assert.equal(await loading, null, "the answer is dropped, so the screen is never given it");
  assert.equal(foldCache().has("m1"), false, "and B's cache does not hold A's fold");
  resetApi();
});

test("an error for the last session is dropped too", async () => {
  forgetFolds();
  setToken("bearer-a");
  const req = pending();
  const loading = loadFold("m1", "complete", req.read);
  setToken("bearer-b");
  req.fail(Object.assign(new Error("gone"), { code: "not_signed_in" }));
  assert.equal(await loading, null);
  resetApi();
});

test("an answer for the same session is cached and returned", async () => {
  forgetFolds();
  setToken("bearer-a");
  const req = pending();
  const loading = loadFold("m1", "complete", req.read);
  req.answer({ events: [], fold: {} });
  const out = await loading;
  assert.ok(out, "returned to the screen");
  assert.equal(foldCache().get("m1"), out, "and cached for this session");
  resetApi();
});
