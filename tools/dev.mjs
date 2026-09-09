#!/usr/bin/env node
/** Runs the web client and the dev API together, and forwards Ctrl-C to both. */
import { spawn } from "node:child_process";

const procs = [
  ["api", "node", ["services/api/server.mjs"]],
  ["web", "pnpm", ["--filter", "@scrbrd/web", "dev"]],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: "inherit", env: process.env });
  p.on("exit", (code) => { if (code) console.error(`${name} exited with ${code}`); shutdown(); });
  return p;
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  for (const p of procs) p.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
