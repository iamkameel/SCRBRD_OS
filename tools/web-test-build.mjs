/**
 * The web client built for a walk that has to press "Continue with Google"
 * (SCRBRD-140): into apps/web/dist-test, never dist.
 *
 * Two things differ from the shipped build, and only here:
 *   - SCRBRD_TEST_HOOKS=1, so window.__SCRBRD_TEST_GOOGLE__ may answer in
 *     place of Google's popup with an ID token the walk signed itself
 *     (lib/google.js). In the shipped build that branch is dead code and the
 *     name is not in the bundle (tools/check-bundle.mjs fails the build if it is).
 *   - dummy web config for the walk's own project, so the button is drawn.
 *     None of it is a key: the "key" is a word, the project is scrbrd-os-test,
 *     and the server the walk runs only accepts tokens signed for that project.
 *
 * Used by tools/smoke-browser-signup.mjs and tools/smoke-a11y.mjs.
 */
import { spawnSync } from "node:child_process";

export const WEB_TEST_ROOT = "apps/web/dist-test";

/** @returns {{ ok: boolean, out: string }} */
export function buildWebForWalk() {
  const made = spawnSync("pnpm", ["--filter", "@scrbrd/web", "exec", "vite", "build", "--outDir", "dist-test", "--emptyOutDir"], {
    env: { ...process.env, SCRBRD_TEST_HOOKS: "1",
           VITE_FIREBASE_API_KEY: "walk-not-a-key", VITE_FIREBASE_AUTH_DOMAIN: "localhost", VITE_FIREBASE_PROJECT_ID: "scrbrd-os-test" },
    encoding: "utf8",
  });
  return { ok: made.status === 0, out: (made.stderr || made.stdout || "").slice(-400) };
}
