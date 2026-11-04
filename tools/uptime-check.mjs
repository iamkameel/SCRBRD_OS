#!/usr/bin/env node
/**
 * The uptime check behind .github/workflows/uptime.yml (pilot item 7).
 *
 * Calls GET /api/health on one environment. A sleeping Render free-plan
 * service takes thirty to sixty seconds to wake, so each round tries up to
 * two times with a ninety second timeout before it counts as down. The
 * environment is DOWN only when two rounds in a row fail, a pause apart, so a
 * single bad boot never raises an alarm.
 *
 * The alert is a GitHub issue titled "Uptime: <env> is down". GitHub emails
 * the repository owner on a new issue, which is the page. A second failing
 * run comments on the issue already open (no second issue); a passing run
 * closes it. Only the built-in GITHUB_TOKEN (issues: write) is used, through
 * the gh CLI the runner carries. The issue names the path, never a body.
 *
 *   node tools/uptime-check.mjs --env prod --url https://scrbrd.onrender.com
 *
 * Exit 0: healthy, or no URL set (a notice). Exit 1: down.
 * Pure logic is exported for tools/uptime-check.test.mjs.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** What the health body must say. Same rule as keep-warm.yml. */
export function judge(code, text) {
  if (!code) return { ok: false, reason: "got no answer (unreachable, or no reply in time)" };
  if (code !== 200) return { ok: false, reason: `answered HTTP ${code}, not 200` };
  let body;
  try { body = JSON.parse(text); } catch { return { ok: false, reason: "answered 200 with a body that is not JSON" }; }
  if (!body || body.ok !== true || body.db !== "ok") {
    return { ok: false, reason: `reports itself unhealthy (ok=${body?.ok}, db=${body?.db})` };
  }
  if (Number(body.audit_failed ?? 0) !== 0) {
    return { ok: false, reason: `reports failed audit-log writes (audit_failed=${body.audit_failed})` };
  }
  return { ok: true, reason: "ok" };
}

/** The health address for a base URL or a full /api/health URL. */
export function healthUrl(base) {
  const b = String(base).trim().replace(/\/+$/, "");
  return b.endsWith("/api/health") ? b : `${b}/api/health`;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** One round: up to `attempts` tries, each with its own timeout. */
export async function round({ url, attempts = 2, timeoutMs = 90_000, pauseMs = 15_000, fetchFn = fetch, sleep = wait, log = () => {} }) {
  let last = { ok: false, reason: "not tried" };
  for (let n = 1; n <= attempts; n++) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
      last = judge(res.status, await res.text());
    } catch {
      last = judge(0, "");
    }
    log(`attempt ${n} of ${attempts}: ${last.ok ? "ok" : last.reason}`);
    if (last.ok) return last;
    if (n < attempts) await sleep(pauseMs);
  }
  return last;
}

/** Down only if every round fails. A pass in any round ends it. */
export async function check({ rounds = 2, roundPauseMs = 120_000, sleep = wait, log = () => {}, ...opts }) {
  let last = { ok: false, reason: "not tried" };
  for (let r = 1; r <= rounds; r++) {
    last = await round({ ...opts, sleep, log });
    if (last.ok) return { ...last, rounds: r };
    log(`round ${r} of ${rounds} failed`);
    if (r < rounds) await sleep(roundPauseMs);
  }
  return { ...last, rounds };
}

export const issueTitle = (env) => `Uptime: ${env} is down`;

/** What to do with the issue. `open` is the open issue's number, or null. */
export function decide({ ok, open }) {
  if (ok) return open ? "close" : "none";
  return open ? "comment" : "create";
}

/** gh through the runner's CLI; injectable for the test. */
function ghRun(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`gh ${args[0]} ${args[1] ?? ""} failed: ${(r.stderr || "").trim().slice(0, 300)}`);
  return r.stdout;
}

export function findOpen(env, gh = ghRun) {
  const list = JSON.parse(gh(["issue", "list", "--state", "open", "--search", `"${issueTitle(env)}" in:title`, "--json", "number,title", "--limit", "20"]) || "[]");
  return list.find((i) => i.title === issueTitle(env))?.number ?? null;
}

export function act(action, { env, open, reason, runUrl, at }, gh = ghRun) {
  const when = at ?? new Date().toISOString();
  const run = runUrl ? `\n\nRun: ${runUrl}` : "";
  if (action === "create") {
    gh(["issue", "create", "--title", issueTitle(env), "--body",
      `GET /api/health on **${env}** failed in two checks in a row, at ${when}.\n\nLast reason: ${reason}.${run}\n\nThis issue closes by itself when the check passes again.`]);
  } else if (action === "comment") {
    gh(["issue", "comment", String(open), "--body", `Still down at ${when}. Last reason: ${reason}.${run}`]);
  } else if (action === "close") {
    gh(["issue", "close", String(open), "--comment", `GET /api/health on ${env} passed at ${when}. Closing.`]);
  }
  return action;
}

async function main() {
  const a = process.argv.slice(2);
  const arg = (k) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  const env = arg("env");
  const base = arg("url") ?? "";
  if (!env) { console.error("usage: uptime-check.mjs --env <name> --url <base>"); process.exit(2); }
  if (!base.trim()) {
    console.log(`::notice::No address is set for ${env}; nothing to check.`);
    return;
  }
  const res = await check({
    url: healthUrl(base),
    attempts: Number(process.env.ATTEMPTS ?? 2),
    timeoutMs: Number(process.env.TIMEOUT_MS ?? 90_000),
    pauseMs: Number(process.env.PAUSE_MS ?? 15_000),
    roundPauseMs: Number(process.env.ROUND_PAUSE_MS ?? 120_000),
    log: (m) => console.log(`${env}: ${m}`),
  });
  const { GITHUB_SERVER_URL: s, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: id } = process.env;
  const runUrl = s && repo && id ? `${s}/${repo}/actions/runs/${id}` : undefined;
  if (process.env.DRY_RUN) {
    console.log(`${env}: ${res.ok ? "up" : "DOWN"} (${res.reason}); dry run, no issue touched`);
    process.exit(res.ok ? 0 : 1);
  }
  const open = findOpen(env);
  const action = act(decide({ ok: res.ok, open }), { env, open, reason: res.reason, runUrl });
  console.log(`${env}: ${res.ok ? "up" : "DOWN"}; issue action: ${action}`);
  if (!res.ok) {
    console.log(`::error title=${env} is down::GET /api/health ${res.reason}, in ${res.rounds} checks`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
