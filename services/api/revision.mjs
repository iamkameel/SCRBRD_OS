// Which commit this process was built from (GA I14: the revision running in
// production can be tied to a reviewed commit).
//
// Render sets RENDER_GIT_COMMIT on every service it builds from a repository;
// anywhere else (Cloud Run, a hand-built image) a deploy can set GIT_COMMIT.
// /api/health reports the value as `revision`, in full, so it can be compared
// with the head of the merged pull request (DEPLOYING.md, "The deployed
// revision"). A short form is a prefix of it.
//
// It is read from the environment and from nowhere else — no `git` call, no
// file read — and only a hex commit id is ever returned. A variable holding
// anything else (a path, a branch name, a token pasted into the wrong
// setting) reads as unknown rather than being echoed on an unauthenticated
// route.

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string | null} the commit id, lower case, or null when unknown
 */
export function revisionFromEnv(env) {
  for (const key of ["RENDER_GIT_COMMIT", "GIT_COMMIT"]) {
    const v = (env[key] ?? "").trim();
    // 7 to 40 hex digits: a short sha up to a full SHA-1 (this repository's
    // object format). Anything longer or not hex is not a commit.
    if (/^[0-9a-f]{7,40}$/i.test(v)) return v.toLowerCase();
  }
  return null;
}
