/**
 * The family fold cache is one session's (views/family/useFold.js). Signing
 * out does not reload the page, so a cache that outlived the session would
 * serve the last person's children's lines to the next person on the device.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setToken, resetApi } from "../src/lib/api.js";
import { foldCache, forgetFolds } from "../src/views/family/useFold.js";

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
