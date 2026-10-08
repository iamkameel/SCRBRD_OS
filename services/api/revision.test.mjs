// GET /api/health reports which commit the process was built from (GA I14).
// The field is built by revisionFromEnv(); the live route is asserted by
// tools/smoke-owner-refusal.mjs, which starts the real server with the
// variable set and unset. This holds the reading of the environment.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { revisionFromEnv } from "./revision.mjs";

let passes = 0, fails = 0;
/** @param {string} label @param {unknown} cond @param {string} [detail] */
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};

const FULL = "0148454a1b2c3d4e5f60718293a4b5c6d7e8f901";
const OTHER = "ffffffffffffffffffffffffffffffffffffffff";

ok("Render's RENDER_GIT_COMMIT is the revision, in full", revisionFromEnv({ RENDER_GIT_COMMIT: FULL }) === FULL);
ok("GIT_COMMIT is used when Render's is not set", revisionFromEnv({ GIT_COMMIT: FULL }) === FULL);
ok("Render's wins when both are set", revisionFromEnv({ RENDER_GIT_COMMIT: FULL, GIT_COMMIT: OTHER }) === FULL);
ok("an empty Render value falls through to GIT_COMMIT", revisionFromEnv({ RENDER_GIT_COMMIT: "", GIT_COMMIT: FULL }) === FULL);
ok("neither set: null, not undefined and not an empty string", revisionFromEnv({}) === null);
ok("blank values: null", revisionFromEnv({ RENDER_GIT_COMMIT: "  ", GIT_COMMIT: "" }) === null);
ok("upper case is read as lower, so a comparison is exact", revisionFromEnv({ GIT_COMMIT: FULL.toUpperCase() }) === FULL);
ok("surrounding whitespace is trimmed", revisionFromEnv({ GIT_COMMIT: ` ${FULL}\n` }) === FULL);
ok("a short sha is kept as given (a prefix of the full one)", revisionFromEnv({ GIT_COMMIT: FULL.slice(0, 7) }) === FULL.slice(0, 7));

// Nothing but a commit id comes out: a mistaken value is unknown, never echoed.
for (const [label, value] of [
  ["a path", "/opt/render/project/src"],
  ["a branch name", "main"],
  ["a token", "ghp_0123456789abcdef0123456789abcdef0123"],
  ["a URL", "https://user:secret@example.invalid/repo.git"],
  ["hex with a suffix", `${FULL}-dirty`],
  ["hex too short to be a commit", "abc123"],
  ["hex too long to be a commit", FULL + "00"],
]) ok(`${label} is not echoed`, revisionFromEnv({ RENDER_GIT_COMMIT: value }) === null);
ok("a bad Render value does not hide a good GIT_COMMIT",
   revisionFromEnv({ RENDER_GIT_COMMIT: "main", GIT_COMMIT: FULL }) === FULL);
ok("no other variable is read (a secret next door is not the revision)",
   revisionFromEnv({ SESSION_SECRET: FULL, DATABASE_URL: FULL }) === null);

// The route puts the one new key on the health body, beside the existing ones.
const server = readFileSync(fileURLToPath(new URL("./server.mjs", import.meta.url)), "utf8");
const health = server.slice(server.indexOf('path === "/api/health"'));
const body = health.slice(health.indexOf("json(res, 200, {"), health.indexOf("});"));
ok("server.mjs reports revisionFromEnv(process.env) as `revision`", /revision: revisionFromEnv\(process\.env\)/.test(body));
ok("…and imports it", /import \{ revisionFromEnv \} from "\.\/revision\.mjs"/.test(server));

console.log(`\nREVISION: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
