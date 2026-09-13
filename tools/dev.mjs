#!/usr/bin/env node
/**
 * Runs the web client and the dev API together, and forwards Ctrl-C to both.
 *
 * THIS IS THE DEVELOPMENT RUN, and it says so to the API. `pnpm dev` used to
 * spawn server.mjs with the shell's environment and nothing else, which meant
 * NODE_ENV was unset and ALLOW_DEV_LOGIN was unset — so the server came up in
 * token-only mode, the Login screen (which asks the server whether dev login is
 * available before showing the seeded people) showed a code field, and a
 * fresh clone had no way to sign in at all: login codes are issued by a school
 * office through login_code_issue(), and none is seeded, on purpose.
 *
 * So this runner sets the two variables a local run needs, as DEFAULTS that an
 * explicit environment overrides. Production never runs through this file —
 * it runs server.mjs directly — so nothing here can leak a development
 * affordance into a deployment. server.mjs itself still refuses dev login
 * whenever NODE_ENV=production, whatever this sets.
 *
 * A root `.env` is loaded if present — parsed here, see readDotEnv() — and
 * Vite reads the same file for VITE_* variables because
 * apps/web/vite.config.js points envDir at the repository root. One file,
 * both processes. `.env.example` documents every variable either one reads.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const env = {
  NODE_ENV: "development",
  ALLOW_DEV_LOGIN: "1",
  ...process.env,           // anything set explicitly wins
};

// A root .env, if present, parsed HERE rather than through node's --env-file.
// The first version detected that flag via process.allowedNodeEnvironmentFlags,
// which only lists flags permitted in NODE_OPTIONS — --env-file is not one, so
// the check said "unsupported" on a Node that supports it perfectly well, and
// the file would never have loaded. Twelve lines with no dependency is the
// honest version: KEY=VALUE, optional quotes, # comments, blank lines. Values
// already in the environment win, exactly as they do for the defaults above.
function readDotEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const fromFile = readDotEnv(".env");
for (const [k, v] of Object.entries(fromFile)) if (!(k in process.env)) env[k] = v;
const loadedFromFile = Object.keys(fromFile).filter((k) => !(k in process.env));

const procs = [
  ["api", process.execPath, ["services/api/server.mjs"]],
  ["web", "pnpm", ["--filter", "@scrbrd/web", "dev"]],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: "inherit", env });
  p.on("exit", (code) => { if (code) console.error(`${name} exited with ${code}`); shutdown(); });
  return p;
});

console.log([
  "",
  "SCRBRD development run",
  loadedFromFile.length ? `  .env    loaded ${loadedFromFile.length} value(s): ${loadedFromFile.join(", ")}` : "  .env    none (defaults in use — see .env.example)",
  `  client  http://localhost:5173`,
  `  api     http://localhost:${env.PORT || 8787}   (health: /api/health)`,
  env.ALLOW_DEV_LOGIN === "1"
    ? "  sign in with any seeded person — pick one on the Login screen, no code needed"
    : "  dev login is OFF (ALLOW_DEV_LOGIN != 1): a login code from the school office is required",
  "",
].join("\n"));

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  for (const p of procs) p.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
